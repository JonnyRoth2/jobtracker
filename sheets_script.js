function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    const ss = SpreadsheetApp.openById("<Replace with your ID>");
    const sheet = ss.getSheetByName("JobApplications");
   
    if (!sheet) {
      throw new Error("Sheet 'JobApplications' not found");
    }

    const lastRow = sheet.getLastRow();

    const urls = lastRow < 2
      ? []
      : sheet.getRange(2, 6, lastRow - 1, 1)
          .getValues()
          .flat();

    if (urls.includes(data.url)) {
      return ContentService
        .createTextOutput(JSON.stringify({ duplicate: true }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    sheet.appendRow([
      new Date(),
      data.company,
      data.title,
      data.location,
      data.source,
      data.url,
      "No Response"
    ]);

    return ContentService
      .createTextOutput(JSON.stringify({ success: true }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({
        success: false,
        error: err.message
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}