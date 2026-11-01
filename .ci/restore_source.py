"""Restore reviewed source through bounded GitHub REST reads; execute no source code."""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import urllib.request

TREE = '833b73e66ef6919f5efb248507d1e133d3044035'
BLOBS = 821
API = 'https://api.github.com/repos/SpiralSky/ai-workflow/git/'
MAX_RESPONSE = 8 * 1024 * 1024
MAX_BLOB = 4 * 1024 * 1024
SHA = re.compile(r'^[0-9a-f]{40}$')


class NoRedirect(urllib.request.HTTPRedirectHandler):
    """Never forward the read token to any redirected endpoint."""
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('Redirect rejected')


def read_json(resource):
    """Read one fixed-origin Git resource, without retries or credential logging."""
    if not re.fullmatch(r'(trees/[0-9a-f]{40}\?recursive=1|blobs/[0-9a-f]{40})', resource):
        raise ValueError('Invalid API resource')
    request = urllib.request.Request(API + resource, headers={
        'Authorization': 'Bearer ' + os.environ['GH_READ_TOKEN'],
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'aiw-reviewed-source-restore',
    })
    with urllib.request.build_opener(NoRedirect()).open(request, timeout=20) as response:
        data = response.read(MAX_RESPONSE + 1)
    if len(data) > MAX_RESPONSE:
        raise ValueError('API response too large')
    return json.loads(data)


def git(cwd, *args, data=None):
    """Run Git without shell expansion, user config, credentials or network."""
    env = {k: v for k, v in os.environ.items() if k not in {'GH_READ_TOKEN', 'GITHUB_TOKEN'}}
    env.update(GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL='/dev/null')
    return subprocess.check_output(['git', '-C', str(cwd), *args], input=data,
                                   env=env, timeout=30, stderr=subprocess.PIPE)


def validate_tree(document, expected=TREE, count=BLOBS):
    """Reject truncation, unsafe names, links, submodules and unexpected inventories."""
    if document.get('sha') != expected or document.get('truncated') is not False:
        raise ValueError('Wrong or truncated root tree')
    files, seen = [], set()
    for entry in document['tree']:
        name = entry['path']
        parts = name.split('/') if isinstance(name, str) else []
        if (not parts or any(p in {'', '.', '..'} or p.lower() == '.git' for p in parts)
                or name.startswith('/') or '\\' in name
                or any(ord(c) < 32 or ord(c) == 127 for c in name) or name in seen):
            raise ValueError('Unsafe or duplicate source path')
        seen.add(name)
        if not SHA.fullmatch(entry['sha']):
            raise ValueError('Invalid object identity')
        if entry['type'] == 'tree' and entry['mode'] == '040000':
            continue
        if entry['type'] != 'blob' or entry['mode'] not in {'100644', '100755'}:
            raise ValueError('Unsupported source mode')
        if not isinstance(entry.get('size'), int) or not 0 <= entry['size'] <= MAX_BLOB:
            raise ValueError('Unsupported blob size')
        files.append(entry)
    if len(files) != count:
        raise ValueError('Unexpected blob inventory')
    if sum(entry['size'] for entry in files) > 32 * 1024 * 1024:
        raise ValueError('Source inventory too large')
    return files


def verify_blob(data, sha, size):
    """Check the Git blob identity, not merely the HTTP transport contents."""
    if len(data) != size or len(data) > MAX_BLOB:
        raise ValueError('Blob size mismatch')
    digest = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
    if digest != sha:
        raise ValueError('Blob hash mismatch')
    return data


def local_blob(repo, sha, size):
    """Reuse only verified local objects; missing objects fall back to REST reads."""
    try:
        if git(repo, 'cat-file', '-t', sha).strip() != b'blob':
            return None
        if int(git(repo, 'cat-file', '-s', sha)) != size:
            raise ValueError('Local object size mismatch')
        return verify_blob(git(repo, 'cat-file', 'blob', sha), sha, size)
    except subprocess.CalledProcessError:
        return None


def restore(repo, destination, read=read_json, expected=TREE, count=BLOBS):
    """Fetch sequentially/fail-stop; materialize only after final write-tree equality."""
    files = validate_tree(read('trees/' + expected + '?recursive=1'), expected, count)
    destination = Path(destination)
    destination.mkdir()  # Existing output is an error; never overwrite another checkout.
    git(destination, 'init', '--quiet')
    loaded = set()
    fetched = 0
    for entry in files:
        sha, size = entry['sha'], entry['size']
        if sha not in loaded:
            data = local_blob(repo, sha, size)
            if data is None:
                blob = read('blobs/' + sha)
                if blob.get('sha') != sha or blob.get('encoding') != 'base64':
                    raise ValueError('Wrong blob API identity/encoding')
                encoded = ''.join(blob['content'].split())
                data = verify_blob(base64.b64decode(encoded, validate=True), sha, size)
                fetched += 1
            written = git(destination, 'hash-object', '-w', '--stdin', data=data).decode().strip()
            if written != sha:
                raise ValueError('Written blob mismatch')
            loaded.add(sha)
        git(destination, 'update-index', '--add', '--cacheinfo', entry['mode'], sha, entry['path'])
    if git(destination, 'write-tree').decode().strip() != expected:
        raise ValueError('Final root tree mismatch')
    git(destination, '-c', 'core.hooksPath=/dev/null', 'checkout-index', '--all')
    print(f'Verified source tree {expected}: {len(files)} files, {fetched} REST blob reads. No model or source tests executed.')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('Usage: restore_source.py LOCAL_GIT_CHECKOUT NEW_DESTINATION')
    try:
        restore(Path(sys.argv[1]), Path(sys.argv[2]))
    except Exception as error:
        # Avoid dumping request objects, headers, environment, or tokens.
        print(f'Source restoration failed: {type(error).__name__}: {error}', file=sys.stderr)
        raise SystemExit(1)
