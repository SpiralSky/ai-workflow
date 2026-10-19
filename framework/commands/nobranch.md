Disable branch mode for this session.

1. Run: `rm -f "$BRANCH_TOGGLE_FLAG"`
2. Run: `sed -i 's|\.system\.always-|.system.stub-|g' "$HOME/CLAUDE.md" 2>/dev/null`
3. Confirm: "Branch mode disabled."
