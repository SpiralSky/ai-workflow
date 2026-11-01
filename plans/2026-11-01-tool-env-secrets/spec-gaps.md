# Gaps and autonomous decisions

System-overview §7 already requires secret stripping for tool descendants. New direct providers
were missing from that implementation. Add DEEPSEEK_ and TYPESAFE_, and defensively CHATGPT_
(no claim that ChatGPT credentials are actually environment-backed). Apply the existing filter
to ripgrep too. Preserve original architecture documents and custom-secret escape hatch.
These are reversible technical decisions, not user approvals or permission changes.
