## Flow commands
`taskflow-cli flow list` List all flow definitions
`taskflow-cli flow get <flowId>` Get a specific flow definition
`taskflow-cli flow create --name "My Flow" --description "Does things" --action <actionId>` Create a flow with action references
`taskflow-cli flow create --name "Pipeline" --description "CI" --action <actionId1> --action <actionId2>` Create a flow with multiple actions
`taskflow-cli flow update <flowId> --name "New name"` Update flow name
`taskflow-cli flow update <flowId> --description "New desc"` Update flow description
`taskflow-cli flow delete <flowId>` Delete a flow
`taskflow-cli flow actions` List all action definitions (alias for action list)
`taskflow-cli flow start <flowId>` Start a flow
`taskflow-cli flow start <flowId> --input key=value` Start a flow with input values
`taskflow-cli flow stop <flowId>` Stop a running flow
`taskflow-cli flow pause <flowId>` Pause a running flow
`taskflow-cli flow resume <flowId>` Resume a paused flow
`taskflow-cli flow skip <flowId>` Skip the current action in a flow
`taskflow-cli flow jump <flowId> <actionIndex>` Jump to a specific action
`taskflow-cli flow status` List all flow runs for current owner
`taskflow-cli flow status <flowId>` Get current flow run state

Note: flowId always refers to flow definition id, not run id.
Note: actionIndex is zero-based.