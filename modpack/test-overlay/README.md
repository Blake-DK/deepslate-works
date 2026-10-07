# modpack/test-overlay

docs/42 T6. Files here are copied over `dist/server/` at the end of a Build on the **test server only**
(`TEST_MODE=1` in `deepslate-api-test`). The live server's build never reads this folder. Each file replaces the
file of the same path that the build made from `modpack/config/` and `modpack/server/`.

- `config/bluemap/core.conf`, `config/bluemap/webserver.conf`: BlueMap does nothing on the test world (no download
  accepted, no web server); its tunnel port belongs to the live instance.
- `config/voicechat/voicechat-server.properties`: Simple Voice Chat on UDP 24464, which nothing forwards.

This README is not copied (Markdown files are left out).
