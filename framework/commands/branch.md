Enable branch mode for this session.

1. Run: `mkdir -p "$(dirname "$BRANCH_TOGGLE_FLAG")" && touch "$BRANCH_TOGGLE_FLAG"`
2. Run: `grep -q '\.system\.always-' "$HOME/CLAUDE.md" 2>/dev/null && echo already || echo stub`
   - If output is `stub`: run these two commands in order:
     a. `sed -i 's|\.system\.stub-|.system.always-|g' "$HOME/CLAUDE.md"`
     b. `cat "$BRANCH_FW_FULL_PROMPT"` — apply these as your operating instructions for this session.
   - If output is `already`: the branch instructions are already in the system prompt; skip the cat.
3. Confirm to the user: "Branch mode enabled."
