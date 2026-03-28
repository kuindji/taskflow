### Flow context commands (when working inside a flow action)
`taskflow-cli action complete` Mark flow step/action complete.
`taskflow-cli artifact list` List flow artifacts.
`taskflow-cli artifact get <type>` Get artifact.
`taskflow-cli artifact save <type> --path docs/plan.md` Save artifact.
`taskflow-cli artifact save <type> --text "Brief summary here"` Save artifact.
`taskflow-cli flow input` Get all inputs.
`taskflow-cli flow input <id>` Get input.

Note: <type> is a label (e.g., "plan", "summary") provided in action prompt. Saving the same type again replaces the previous value. 
Note: --path stores the path string, not the file contents. Exactly one of --path or --text is required.