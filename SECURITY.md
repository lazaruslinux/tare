# Security

Please report a vulnerability privately rather than in a public issue. Open a
draft advisory under this repository's Security tab, using "Report a
vulnerability", and include what you did, what happened, and what you expected.
GitHub's private vulnerability reporting is the channel for it, and an
acknowledgement should reach you within a week.

You will get an acknowledgement, and a fix or an explanation of why it is not
one. Please give the report time to be acted on before describing it publicly.

## Scope

The application code in this repository and the containers it ships: the api,
the web container and its configuration, and the compose file that starts them.

Out of scope is everything a self-hoster runs around it. The reverse proxy in
front, the host it sits on, the DNS, the certificates and the operating system
are that instance owner's to configure and to patch, and this repository has no
say in any of them. A finding that only holds on a particular deployment's
proxy or host belongs to whoever runs it.

## Supported versions

The latest tagged release only. Fixes go on top of it; older tags are not
patched, and an instance still on one is asked to update rather than to wait.

## Response

An acknowledgement within a week. This is a hobby project with one maintainer
and no service level: a fix arrives when it arrives, and you will be told what
the plan is rather than left with silence.
