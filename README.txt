PATIENT CONNECT — TRUE CLEAN RECOVERY

This is the actual clean baseline.

IMPORTANT:
The previous "full reset" package was built from a later GitHub export that
already contained experimental reply/forward code. This recovery package removes
those experiments completely.

Replace ALL THREE files in GitHub:
1. inbox.html
2. server.js
3. package.json

Clean server routes include only the stable inbox APIs:
- messages
- patient-name
- read/unread
- media
- normal reply

REMOVED:
- quoted reply experimental endpoint
- forward experimental endpoint
- message-level menu experiments

Node is pinned to 22.x to avoid the Render Node 26 alpha build failure.

DO NOT CHANGE:
- Supabase
- Meta / WhatsApp settings
- Render environment variables

DEPLOY:
1. Commit all three files.
2. Render -> Manual Deploy -> Deploy latest commit.
3. Wait for green Live.
4. Open /inbox and Ctrl+F5.
