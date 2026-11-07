# Cisco FTD syslog

The live UDP and newline-delimited TCP receivers and file replay use the same FTD event parser. It accepts JSON objects containing `message_id` 430001 or 430002, with or without a syslog prefix. Older messages with the event ID in the prefix remain supported. For JSON with an explicit `message_id`, that field determines the event type.

Connection events can contain `InitiatorIP`, `ResponderIP`, `Protocol`, `AC_RuleAction`, and `EventPriority`. Intrusion events can contain `PriorityID`, `IntrusionRuleMessage`, and `InlineResult`; reputation events can contain `IP_ReputationSI_Category`. Reputation takes precedence over numeric intrusion priority, which takes precedence over `EventPriority` for coloring. Priority is a device-reported property, not proof that the connection is malicious.

Private-to-private traffic and configured ignored destinations are excluded. A private endpoint uses the configured home location when geolocation is unavailable, and both endpoints need coordinates to appear on the map. Private initiators retain their original direction when connecting to an OpenDNS responder. See the README for setup and the legacy public-initiator OpenDNS behavior.
