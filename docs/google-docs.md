# Google Docs transfer

[Documentation home](./README.md)

Tagline supports **direct Google sign-in** and **Apps Script webhook** method.
Both convert notes and DOCX/HTML uploads into a **new Google Doc**
in the selected account's Drive. Neither overwrites existing
documents or changes their sharing permissions. With a script-configured
destination folder, folder permissions can be inherited.
No document is sent until you explicitly confirm an upload.

## Connect directly to Google

1. Open **Settings > Integrations > Google Docs / Drive**.
2. Select **Connect Google account**. Tagline opens Google's authorization page
   in your system browser, not an embedded sign-in window.
3. Choose the intended account and grant email and per-file Drive access.
4. Return to Tagline and confirm the account shown in the native connection
   dialog. **Cancel Google sign-in** cancels a pending browser authorization;
   an unfinished sign-in times out after three minutes.
5. Select this connection before uploading, or choose it under
   **Destination Google account** in the note export dialog.

No script deployment, webhook URL, API key, or shared secret is needed.
Uploads go directly from Tagline to Google's Drive API and are converted into
new Google Docs in My Drive.

The desktop OAuth client requests only `openid`,
`https://www.googleapis.com/auth/userinfo.email`, and
`https://www.googleapis.com/auth/drive.file`. The latter allows access to files
created by or explicitly authorized for Tagline, not unrestricted access to
your entire Drive. Uploads use the identity returned by Google, not a manually
entered account label.

Refresh tokens are protected with OS credential encryption in the app profile;
they are never exposed to the renderer, stored in the vault, or written into
note settings. Access tokens stay in main-process memory for each operation.
Tagline uses PKCE, a random state value, and a temporary callback listener bound
only to `127.0.0.1`. That listener closes after sign-in, cancellation, or timeout.

**Development/testing:** while the Google Cloud project's OAuth audience is in
Testing, only registered test accounts can connect.

**Disconnect Google Docs** removes the selected local connection and its
encrypted credentials, leaving documents and other connections unchanged.
It does not revoke Google's authorization grant. To revoke the grant, remove
Tagline from your [Google Account connections](https://myaccount.google.com/connections).
Revoked or expired authorization produces an explicit reconnect error.
Uploads are not automatically retried, to avoid duplicate documents when a
network failure leaves their creation uncertain.

## Set up an Apps Script webhook

To add a webhook while a direct connection is selected, choose
**Add a connection / choose an account** to reveal the webhook fields.

1. Open **Settings > Integrations > Set up Google Docs transfer**. Save or copy
   the bundled [Google Apps Script](../electron/google-docs-webhook.gs).
2. Open [Google Apps Script](https://script.google.com/home/start), create a
   project, and replace `Code.gs` with the script.
3. Next to **Services**, select **+** and add **Drive API**, version **v3**.
   For a standard Google Cloud project, also enable Google Drive API in that
   project's Cloud console. See Google's
   [advanced Drive service guide](https://developers.google.com/apps-script/advanced/drive).
4. In **Project Settings > Script properties**, add `WEBHOOK_SECRET` with a
   random secret of 32-256 non-space ASCII characters. Use **Generate secret**
   and **Copy secret** in Tagline, or a password manager. Paste the identical
   value into Tagline's **Webhook secret** field.
5. Optionally add `TARGET_FOLDER_ID` with the destination folder's ID, not its
   URL. The script's account must have permission to create files there.
   Without this property, new documents go to the script owner's My Drive.
6. In the script editor, select `authorizeGoogleDocs`, click **Run**, and grant
   your own script Drive access. Review the script before authorizing it.
7. Select **Deploy > New deployment > Web app**, set **Execute as** to **Me**
   and **Who has access** to **Anyone**, and deploy. The script checks the
   shared secret itself. If your Workspace administrator prohibits anonymous
   web apps, this integration will not work; a sign-in-only deployment cannot
   be called by Tagline.
8. Select **Add a connection / choose an account** in Tagline, enter the
   deployment URL ending in `/exec` and the same secret, and select **Save
   Google Docs connection**. Tagline makes an authenticated, read-only account
   lookup and asks you to confirm the executing Google account's email before
   saving. No document is uploaded during verification. Do not use the `/dev`
   test URL. Copied `/macros/u/2/s/.../exec` URLs and `authuser` hints are
   normalized to the account-independent deployment URL; other query
   parameters are rejected. After editing the script, deploy a new version
   using **Deploy > Manage deployments**.

The secret is encrypted with the OS credential service in the app profile,
not saved in note settings or the vault. If OS encryption is unavailable,
Tagline will not save the connection. **Disconnect Google Docs** removes only
the selected local connection, not other connections, deployments, or documents.

## Multiple Google accounts

For direct sign-in, use **Connect Google account** again and choose a different
Google account. Reconnecting the same Google identity updates its direct
connection instead of creating a duplicate. Direct and script connections to
the same account remain separate choices labeled by connection method.

For the webhook method, create a separate Apps Script deployment and secret for each Google account,
then add each connection in Tagline. Use a **separate browser profile**, or a
private window signed into only the intended account, to create and authorize
each deployment. Google documents
[Apps Script problems with simultaneous Google logins](https://developers.google.com/apps-script/guides/support/troubleshooting#issues_with_multiple_google_accounts).
Selecting a different browser account later does **not** change the upload
destination: **Execute as: Me** runs as the account that deployed the script.

Tagline shows the verified email next to each saved connection. Select the
connection before uploading a file, and choose **Destination Google account**
in the note export dialog. With multiple verified connections the export
dialog does not silently select the first one. The upload confirmation includes
the email and deployment URL; emails identify the executing account, while
different deployment IDs distinguish connections targeting different folders.

Before sending document content, Tagline checks the account again. For direct
connections it refreshes authorization and checks the account's stable identity
and email. Each webhook upload also carries `expectedAccount`; the script checks it before
creating anything and returns **409** on a mismatch. Account changes require
explicit reverification and confirmation through **Save Google Docs connection**.
No browser cookies or numeric browser-account indices determine the upload.

**Open Google Doc** uses the account from the completed upload, even if you
subsequently switch connections. It adds an email-based `authuser` hint rather
than assuming `/u/0` is correct. This is a navigation hint, not authentication:
Google may still require sign-in or account selection. If Google opens the
wrong session, use a dedicated browser profile signed into that account.

## Send documents

- On a note, choose **Export > Google Docs > Send to Google Docs**. This sends
  the entire note, including unsaved edits, as HTML. Pandoc is not required.
  As with HTML export, wiki links become labels and images are omitted.
- Under **Settings > Integrations > Google Docs / Drive**, select
  **Upload DOCX or HTML...** to choose an existing `.docx`, `.html`, or `.htm`
  file. Maximum unencoded size: **5 MiB**.
- Confirm the document name and destination deployment in the native dialog.
  The app displays success code **201** and an **Open Google Doc** button.

## Webhook contract

Send `POST` with `Content-Type: application/json`:

```json
{
  "secret": "<your WEBHOOK_SECRET>",
  "action": "upload",
  "expectedAccount": "you@example.com",
  "title": "Evidence",
  "mimeType": "text/html",
  "contentBase64": "<standard base64-encoded file bytes>"
}
```

Supported MIME types:

- `text/html` (UTF-8 HTML)
- `application/vnd.openxmlformats-officedocument.wordprocessingml.document`

`title` must be 1-200 characters without control characters. Content must be
non-empty standard base64 with padding and decode to at most 5 MiB.
`expectedAccount` must match the executing account returned by the authenticated
account lookup; it is mandatory even if `action` is omitted for an upload.
This accepts uploaded files, not `.gdoc` shortcut files, Google Doc URLs, or
arbitrary remote download URLs.

Before uploading, verify the account with a read-only POST:

```json
{
  "secret": "<your WEBHOOK_SECRET>",
  "action": "account"
}
```

It returns `ok: true`, `code: 200`, `document: null`, and
`account: { "email": "you@example.com", "displayName": "Your name" }`.
The account comes from `Drive.About.get`, not the active browser user, request
parameters, or a manually entered label. An incorrect secret cannot retrieve
account information.

Every response generated by the script has the same JSON shape:

```json
{
  "ok": true,
  "code": 201,
  "message": "Google Doc created.",
  "account": {
    "email": "you@example.com",
    "displayName": "Your name"
  },
  "document": {
    "id": "<new Google Doc ID>",
    "title": "Evidence",
    "url": "https://docs.google.com/document/d/<new Google Doc ID>/edit"
  }
}
```

Errors use `ok: false`, a numeric `code`, a descriptive `message`, and
`document: null`, and `account: null`:

| Code | Meaning |
| --- | --- |
| 200 | Executing account verified; no document was created. |
| 201 | A new Google Doc was created. |
| 400 | Missing/malformed JSON body or invalid title. |
| 401 | Missing or incorrect shared secret. |
| 405 | GET is unsupported; use POST. |
| 409 | Missing/mismatched expected Google account. No document was created. |
| 413 | Request or decoded file exceeds the size limit. |
| 415 | Unsupported request Content-Type or document MIME type. |
| 422 | Missing, empty, or malformed base64 content. |
| 500 | Unexpected script/configuration error. |
| 502 | Drive account lookup or creation/conversion failed, or returned no valid document ID. Check authorization, folder access, storage, and quotas. |
| 503 | Missing/invalid script properties, advanced Drive service not enabled, or executing account could not be identified. |

Clients must follow the ContentService redirect to
`script.googleusercontent.com` to retrieve the JSON. Send the secret only in
the initial POST body; do not forward it to redirected requests. Tagline
follows the expected 302/303 redirect as a bodyless GET and rejects redirects
to unrelated hosts. See Google's
[Content service documentation](https://developers.google.com/apps-script/guides/content#redirects).
