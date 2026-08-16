### Flow context commands (when working inside a flow action)
`taskflow-cli action complete` Mark flow step/action complete.
`taskflow-cli flow complete` End the whole flow now (in a looped flow, stops the loop).
`taskflow-cli artifact list` List flow artifacts.
`taskflow-cli artifact get <type>` Get artifact.
`taskflow-cli artifact save <type> --path docs/plan.md` Save artifact.
`taskflow-cli artifact save <type> --text "Brief summary here"` Save artifact.
`taskflow-cli flow input` Get all inputs.
`taskflow-cli flow input <id>` Get input.

Note: <type> is a label (e.g., "plan", "summary") provided in action prompt. Saving the same type again replaces the previous value, whether the earlier value came from this action or an earlier one — `artifact get <type>` and `artifact list` only ever return the newest value for a label, so fold anything you still need into the value you save. 
Note: --path stores the path string, not the file contents. Exactly one of --path or --text is required.
Note: in a looped flow, `action complete` finishes the current step and the flow moves on; after the last step it starts again from the first. `flow complete` ends the entire run immediately. Reuse the same artifact `<type>` names on every iteration rather than inventing new ones per lap.