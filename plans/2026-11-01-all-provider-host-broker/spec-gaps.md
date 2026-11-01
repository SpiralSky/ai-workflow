# Experimental decisions — not approvals

- **HB-1:** Runner-owned orchestrate containers no longer make direct API calls over bridge egress. All providers use the existing closed-until-attested host broker and network-none containers. Existing standalone server direct-API configuration is not used by the runner.
- **HB-2:** Legacy OpenRouter secondary calls omitted temperature and other generation overrides, using the configured secondary model and 300-second timeout. Preserve those omissions rather than guessing a numeric provider default or copying the main-model temperature.
- **HB-3:** Host Docker subprocess environment is now an explicit platform/Docker-connection allowlist. Provider keys/endpoints and arbitrary extra environment values are not copied. This does not modify Docker configuration, task permissions, credentials or system settings.
- **HB-4:** Provider errors are classified internally but raw provider/transport messages are not reflected to main-loop errors or task peers. Status and error kind remain available; sensitive diagnostic detail is intentionally lost.

No changes to original specification statuses, model policy or user approval requirements. No hard dollar-cap claim; monetary budget enforcement remains per attempt.
