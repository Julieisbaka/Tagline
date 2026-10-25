// Deploy as a web app, executing as you. See docs/google-docs.md.
var TAGLINE_MAX_BYTES = 5 * 1024 * 1024;
var TAGLINE_MAX_BASE64 = 4 * Math.ceil(TAGLINE_MAX_BYTES / 3);

function taglineReply(code, message, document, account) {
  return ContentService.createTextOutput(JSON.stringify({
    ok: code === 200 || code === 201,
    code: code,
    message: message,
    document: document || null,
    account: account || null
  })).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return taglineReply(405, 'Use POST with a JSON document upload.');
}

function doPost(event) {
  try {
    var properties = PropertiesService.getScriptProperties();
    var expectedSecret = properties.getProperty('WEBHOOK_SECRET');
    if (!expectedSecret || !/^[!-~]{32,256}$/.test(expectedSecret)) {
      return taglineReply(503, 'Configure WEBHOOK_SECRET with 32-256 non-space ASCII characters.');
    }
    if (!event || !event.postData || typeof event.postData.contents !== 'string') {
      return taglineReply(400, 'A JSON request body is required.');
    }
    if (!/^application\/json(?:\s*;|$)/i.test(event.postData.type || '')) {
      return taglineReply(415, 'Use application/json.');
    }
    if (event.postData.contents.length > TAGLINE_MAX_BASE64 + 4096) {
      return taglineReply(413, 'Documents must not exceed 5 MiB.');
    }
    var request;
    try {
      request = JSON.parse(event.postData.contents);
    } catch (error) {
      return taglineReply(400, 'The request body is not valid JSON.');
    }
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
      return taglineReply(400, 'The request body must be a JSON object.');
    }
    if (typeof request.secret !== 'string' || request.secret !== expectedSecret) {
      return taglineReply(401, 'The webhook secret is incorrect.');
    }
    if (typeof Drive === 'undefined' || !Drive.Files || !Drive.Files.create || !Drive.About) {
      return taglineReply(503, 'Enable the advanced Google Drive service (v3).');
    }
    var account;
    try {
      var user = Drive.About.get({ fields: 'user(emailAddress,displayName)' }).user;
      if (!user || typeof user.emailAddress !== 'string' ||
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.emailAddress) || user.emailAddress.length > 254) {
        return taglineReply(503, 'Drive did not identify the executing Google account.');
      }
      account = {
        email: user.emailAddress.toLowerCase(),
        displayName: typeof user.displayName === 'string' ? user.displayName.slice(0, 200) : ''
      };
    } catch (error) {
      return taglineReply(502, 'Could not verify the executing Google account. Check Drive authorization and quotas.');
    }
    if (request.action === 'account') {
      return taglineReply(200, 'Google account verified.', null, account);
    }
    if (request.action !== undefined && request.action !== 'upload') {
      return taglineReply(400, 'Use the account or upload action.');
    }
    // Bind uploads to the verified executor, never the browser's active account.
    if (typeof request.expectedAccount !== 'string' ||
        request.expectedAccount.toLowerCase() !== account.email) {
      return taglineReply(409, 'The executing Google account does not match the selected destination. No document was created.');
    }
    if (typeof request.title !== 'string' || !request.title.trim() ||
        request.title.length > 200 || /[\u0000-\u001f]/.test(request.title)) {
      return taglineReply(400, 'Provide a title of 1-200 characters without control characters.');
    }
    var extensions = {
      'text/html': '.html',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx'
    };
    if (typeof request.mimeType !== 'string' || !Object.prototype.hasOwnProperty.call(extensions, request.mimeType)) {
      return taglineReply(415, 'Only HTML and DOCX documents are supported.');
    }
    if (typeof request.contentBase64 !== 'string' || !request.contentBase64.length) {
      return taglineReply(422, 'Provide non-empty standard base64 document content.');
    }
    if (request.contentBase64.length > TAGLINE_MAX_BASE64) {
      return taglineReply(413, 'Documents must not exceed 5 MiB.');
    }
    if (request.contentBase64.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(request.contentBase64) ||
        !/^[^=]*={0,2}$/.test(request.contentBase64)) {
      return taglineReply(422, 'Document content is not valid standard base64.');
    }
    var bytes;
    try {
      bytes = Utilities.base64Decode(request.contentBase64);
    } catch (error) {
      return taglineReply(422, 'Document content could not be decoded.');
    }
    if (!bytes.length) return taglineReply(422, 'Document content is empty.');
    if (bytes.length > TAGLINE_MAX_BYTES) return taglineReply(413, 'Documents must not exceed 5 MiB.');
    var metadata = {
      name: request.title.trim(),
      mimeType: 'application/vnd.google-apps.document'
    };
    var folderId = properties.getProperty('TARGET_FOLDER_ID');
    if (folderId) {
      if (!/^[A-Za-z0-9_-]+$/.test(folderId)) return taglineReply(503, 'TARGET_FOLDER_ID must be a Drive folder ID, not a URL.');
      metadata.parents = [folderId];
    }
    var file;
    try {
      var blob = Utilities.newBlob(bytes, request.mimeType, metadata.name + extensions[request.mimeType]);
      file = Drive.Files.create(metadata, blob, { fields: 'id', supportsAllDrives: true });
    } catch (error) {
      return taglineReply(502, 'Drive could not create the Google Doc. Check script authorization, folder access, conversion support, storage, and quotas.');
    }
    if (!file || typeof file.id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(file.id)) {
      return taglineReply(502, 'Drive did not return a document ID. Check Drive before retrying.');
    }
    return taglineReply(201, 'Google Doc created.', {
      id: file.id,
      title: metadata.name,
      url: 'https://docs.google.com/document/d/' + file.id + '/edit'
    }, account);
  } catch (error) {
    return taglineReply(500, 'The webhook encountered an unexpected error. Check the Apps Script configuration.');
  }
}

function authorizeGoogleDocs() {
  // Run once in the editor to authorize the Drive service before deployment.
  Drive.About.get({ fields: 'user(emailAddress,displayName)' });
}
