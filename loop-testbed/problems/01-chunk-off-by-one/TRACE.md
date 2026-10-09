# Preface
Tool calls are just html tags here for simplicity. I am not sure of the exact format.
Example:
<bash></bash>

### Tools:

#### bash
Executes command in bash at "current directory" (might be a simplification)

#### branch
Contains a list of instructions (separated by semicolons).
E.g. do {} then {}.

Branch tool call output is removed and not added to context, only a description of what it is doing ($$ comments)

Syntax within instructions:
{} | Block, used to encapsulate other instructions.
**NOTES**:
1. Output of previous block will be automatically passed to next block if its a capture (in capture value).
2. <branch> acts as a block in itself (and thus has all its properties).

() -> {} | Capture, basically works like js lambda functions. Bracket not required if single statement but may look confusing.
() | Just used to wrap something like in "if () else ()->{}" statements.
"" | String literal
<something> | Used within examples to mean you can put Blocks, Captures, String literals, etc.

##### Instructions:
do <something> then ()->{} | Do something and pass the result into the supplied capture. Also returns the result of capture.

if <something> then ()->{} else ()->{} | If else statement (branching). elseif can be added after if statement.

return <something> | Returns something as the output (directly to next LLM step).
blockReturn <something> | Used to supply "return value" of a block if any.

quickClassify <something> case <something>, ()->{} case <something>, ()->{} | Use comma separated pairs of case and Captures. Uses jev-like model to classify quickly (case descriptions are supplied directly).

returnUser <something> | Same as return, but does not pass the message to the LLM, instead to the user.

#### Instruction Functions:
Instruction functions are functions that can be called inside the branch tool call. Should have same syntax as js functions (comma separated, etc)

bool() | Evaluates the statement as true/false. *Potentially use jev-like classifiers (like jev by typesafe, there are open-source versions) for speedups and cost cutting.*
weakLLM() | Evaluates contents using a weak LLM.
llm() | Evaluates contents using same LLM (strong).

#### Operators:
Operators apply normally


Tool calls can be within blocks/captures.

#### Other Stuff:
fstrings apply
string concatenation applies

## Step 1

### Notes
Tool definitions are not included here, but previous context is included.

### LLM Input
`chunk()` in `chunks.py` sometimes loses items. Fix it.

### LLM Output

<branch>
    $$ Finding chunks.py and its contents if available.
    do {
        <bash>ls -aF</bash>
    }
    then (out) -> {
        quickClassify (out)
        case "Is an error", () -> {
            return f"An error occured: {out}"
        }
        case "The string contains chunks.py", () -> {
            return "chunks.py is in the current directory.\nContents:\n\n" + <bash>cat chunks.py | awk '/^def chunk\(/ {p=1; print; next} p { if (/^[ \t]+/) print; else if (/^$/) print; else p=0 }'</bash>
        }
        case "The string does not contain chunks.py", () -> {
            returnUser "chunks.py cannot be found. Please let me know where chunks.py is."
        }
    };
    (chunks_function_snippet) -> {
        quickClassify (chunks_function_snippet)
        case "There is enough information to describe what the function does", () -> {
            return llm(f"Fix the following function chunk() sometimes losing items:\n\n{chunks_function_snippet}")
        }
        case "There is not enough information to understand what the function does", () -> {
            **Not going to fully write this, can become long, but either defers to LLM with summary of what happened or more branches to find related functions**
        }
    }
    **Not going to complete but involves updating the file which i dont know how it works either**
</branch>

### Notes
Using -a may or may not be optimal for `ls`.

Not sure if using `tree -L 3 | grep chunks.py` directly is better. In fact, searching in itself should be isolated into a tool call. This conversation simulation is of course neither fullproof nor perfect, therefore delegated to the user directly.

quickClassify case descriptions are more intuitive towards branching and may have to be rewritten via a small, lightweight LLM for actual classification labels.

The awk used is of course inferred by the .py file extension.
