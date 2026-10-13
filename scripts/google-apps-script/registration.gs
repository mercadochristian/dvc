const SPREADSHEET_ID = "https://docs.google.com/spreadsheets/d/1pNPcXnhfr4YzTJJGshrmD_ZCxKh2dYhbxn-UCi1VGHU/edit?resourcekey=&gid=1222870193#gid=1222870193";

const ss = SpreadsheetApp.openByUrl(SPREADSHEET_ID);
const form = FormApp.getActiveForm();

const scheduleSheet = ss.getSheetByName("Game Schedule");
const slotsSheet = ss.getSheetByName("Slots Available");
const responseSheet = ss.getSheetByName("Form Responses 1");

// Palette of team colors — cycles through as more teams register
const TEAM_COLORS = [
  "#fff2cc", // light yellow
  "#d9ead3", // light green
  "#cfe2f3", // light blue
  "#f4cccc", // light red
  "#d9d2e9", // light purple
  "#fce5cd", // light orange
  "#d0e0e3", // light teal
  "#ead1dc", // light pink
];

// Where team rows start on each game sheet (must be safely below the QUERY output)
const TEAM_START_ROW = 20;

// Explicit timezone — all date formatting and parsing uses Manila time
const TIMEZONE = "Asia/Manila";

function syncGameSystem() {

  /* ==================================
     PART 1 — POPULATE FORM OPTIONS
  ================================== */

  const data = scheduleSheet.getDataRange().getValues();
  const options = [];

  for (let i = 1; i < data.length; i++) {

    const date = data[i][0];
    const venue = data[i][1];
    const time = data[i][2];

    if (!date || !venue || !time) continue;

    const formattedDate = Utilities.formatDate(
      new Date(date),
      TIMEZONE,
      "MM-dd-yy"
    );

    const day = Utilities.formatDate(
      new Date(date),
      TIMEZONE,
      "EEE"
    );

    const option = `${formattedDate} - ${venue} (${day}, ${time})`;
    options.push(option);
  }

  const dropdown = form.getItems(FormApp.ItemType.LIST)[0].asListItem();
  dropdown.setChoiceValues(options);

  options.forEach(name => {

    const safeName = name.replace(/[\\\/\?\*\[\]]/g, "").substring(0, 99);
    let sheet = ss.getSheetByName(safeName)

    if (!sheet) {
      sheet = ss.insertSheet(safeName);
    }

    sheet.getRange("A1").setValue(safeName);
    sheet.getRange("A2").setValue(`=QUERY('Form Responses 1'!A:Z, "SELECT * WHERE C = '" & A1 & "'", 1)`);
  });
}

function generateSlotsLayout() {

  const data = scheduleSheet.getDataRange().getValues();
  data.shift(); // remove header row

  slotsSheet.clear(); // clear Slots sheet before generating

  let row = 1;
  let col = 1;
  const colStep = 5; // gap between tables (4 columns + 1 space)

  for (let i = 0; i < data.length; i++) {

    const date = data[i][0];
    const venue = data[i][1];
    const time = data[i][2];

    if (!date || !venue || !time) continue;

    const formattedDate = Utilities.formatDate(
      new Date(date),
      TIMEZONE,
      "MM-dd-yy"
    );

    const day = Utilities.formatDate(
      new Date(date),
      TIMEZONE,
      "EEE"
    );

    const scheduleName = `${formattedDate} - ${venue} (${day}, ${time})`;

    // data.shift() removed the header, so data[i] maps to Game Schedule row i + 2.
    // Column D holds the team count.
    const scheduleRow = i + 2;
    const teamsCell = `'Game Schedule'!$D$${scheduleRow}`;

    const headerCell = slotsSheet.getRange(row, col);
    const tableHeaders = ["Position", "Needed", "Filled", "Available"];

    // --- HEADER ---
    const headerRange = slotsSheet.getRange(row, col, 1, 4);
    headerRange.merge();
    headerRange.setValue(scheduleName)
      .setFontWeight("bold")
      .setHorizontalAlignment("left");

    // --- TABLE HEADER ---
    const headerRow = row + 1;
    slotsSheet.getRange(headerRow, col, 1, 4)
      .setValues([tableHeaders])
      .setFontWeight("bold")
      .setBackground("#f0f0f0");

    slotsSheet.getRange(row, col, 1, 4).merge();
    slotsSheet.getRange(row + 1, col, 1, 4).setValues([tableHeaders]).setFontWeight("bold").setBackground("#f0f0f0");

    // --- POSITIONS: [label, multiplier per team] ---
    const positions = [
      ["Open Spiker", 2],
      ["Opposite Spiker", 1],
      ["Middle Blocker", 2],
      ["Setter", 1],
    ];

    const startRow = row + 2;

    // Position labels
    slotsSheet.getRange(startRow, col, positions.length, 1)
      .setValues(positions.map(p => [p[0]]));

    // --- SET FORMULAS (Needed + Filled + Available) ---
    positions.forEach((pos, idx) => {
      const thisRow = startRow + idx;

      // Needed = multiplier × teams, linked live to Game Schedule column D
      slotsSheet.getRange(thisRow, col + 1).setFormula(`=${pos[1]}*${teamsCell}`);

      // Filled (COUNTIF from the game sheet)
      const formulaFilled = `=COUNTIF('${scheduleName}'!M:M, "${pos[0]}")`;
      slotsSheet.getRange(thisRow, col + 2).setFormula(formulaFilled);

      // Available = Needed - Filled
      const neededCell = slotsSheet.getRange(thisRow, col + 1).getA1Notation();
      const filledCell = slotsSheet.getRange(thisRow, col + 2).getA1Notation();
      slotsSheet.getRange(thisRow, col + 3).setFormula(`=${neededCell}-${filledCell}`);
    });

    for (let c = col; c < col + 4; c++) {
      slotsSheet.setColumnWidth(c, 120);
    }

    // Move next block (2 per row)
    if (col === 1) {
      col += colStep; // move right
    } else {
      col = 1; // back to first column
      row += positions.length + 4; // move down for next pair
    }
  }
}

/* ==================================
   PART 3 — ON FORM SUBMIT HANDLER
   Runs as a SPREADSHEET trigger.
   - Sends calendar invite to the submitter
   - If "Registration Type" is "Team", auto-adds remaining 5 team members
     to the matching GAME SHEET (not Form Responses 1)
================================== */

function onFormSubmit(e) {
  try {
    const submittedRowIndex = e.range.getRow();
    const headers = responseSheet.getRange(1, 1, 1, responseSheet.getLastColumn()).getValues()[0];
    const submittedRow = responseSheet.getRange(submittedRowIndex, 1, 1, responseSheet.getLastColumn()).getValues()[0];
    const getField = (headerName) => {
      const idx = headers.findIndex(h => String(h).toLowerCase().includes(headerName.toLowerCase()));
      return idx === -1 ? "" : submittedRow[idx];
    };
    const responderEmail = getField("email");
    const playerName = `${getField("first name")} ${getField("last name")}`;
    const position = getField("position");
    const scheduleOption = getField("schedule") || getField("game") || getField("date");
    const registrationType = getField("registration type");

    // Save all additional team rows before notifying the app.
    if (String(registrationType).toLowerCase() === "team registration (6)") {
      addTeamMembersToGameSheet({
        submittedRowIndex, submittedRow, headers,
        submittedPosition: position, scheduleOption
      });
    }
    SpreadsheetApp.flush();

    // A notification failure must not prevent the calendar invite.
    try {
      notifyDvcApp(scheduleOption);
    } catch (err) {
      Logger.log("DVC app notification failed: " + err.message);
    }

    // An invite failure must not prevent sheet updates or app notifications.
    try {
      sendCalendarInvite({ responderEmail, playerName, position, scheduleOption });
    } catch (err) {
      Logger.log("Calendar invite failed: " + err.message);
    }
  } catch (err) {
    Logger.log("onFormSubmit error: " + err);
  }
}

/* ==================================
   STEP A — CALENDAR INVITE
================================== */

function sendCalendarInvite({ responderEmail, playerName, position, scheduleOption }) {
  if (!responderEmail) {
    Logger.log("No responder email found. Make sure 'Collect email addresses' is enabled in form settings.");
    return;
  }

  if (!scheduleOption) {
    Logger.log("No schedule selected in submission.");
    return;
  }

  const match = String(scheduleOption).match(/^(\d{2}-\d{2}-\d{2})\s*-\s*(.+?)\s*\(([A-Za-z]+),\s*(.+)\)$/);

  if (!match) {
    Logger.log("Could not parse schedule option: " + scheduleOption);
    return;
  }

  const datePart = match[1];
  const venue    = match[2];
  const timePart = match[4];

  const [startTimeStr, endTimeStr] = timePart.split(/\s*-\s*/).map(s => s.trim());

  const startDate = parseDateTime(datePart, startTimeStr);
  const endDate   = parseDateTime(datePart, endTimeStr);

  if (!startDate || !endDate) {
    Logger.log("Could not parse date/time.");
    return;
  }

  if (endDate <= startDate) {
    endDate.setDate(endDate.getDate() + 1);
  }

  const title = `Dreamers Volleyball Club — ${venue}`;
  const description =
    `You're confirmed for a Dreamers Volleyball Club game.\n\n` +
    `Player: ${playerName || "(not provided)"}\n` +
    `Position: ${position || "(not provided)"}\n` +
    `Venue: ${venue}\n\n` +
    `If you can't make it, please let the organizer know ASAP.`;

  const isGoogleUser = isLikelyGoogleAccount(responderEmail);

  const calendar = CalendarApp.getDefaultCalendar();
  const event = calendar.createEvent(title, startDate, endDate, {
    location: venue,
    description: description,
    guests: responderEmail,
    sendInvites: isGoogleUser
  });

  if (!isGoogleUser) {
    const organizerEmail = Session.getActiveUser().getEmail();
    const icsContent = buildICS({
      uid: event.getId(),
      title: title,
      description: description,
      location: venue,
      startDate: startDate,
      endDate: endDate,
      organizerEmail: organizerEmail,
      attendeeEmail: responderEmail
    });

    const icsBlob = Utilities.newBlob(icsContent, "text/calendar;method=REQUEST;charset=UTF-8", "invite.ics");

    MailApp.sendEmail({
      to: responderEmail,
      subject: `Invite: ${title} — ${Utilities.formatDate(startDate, TIMEZONE, "MMM d, h:mm a")}`,
      htmlBody:
        `<p>Hi${playerName ? " " + playerName : ""},</p>` +
        `<p>You're confirmed for <b>${title}</b>.</p>` +
        `<ul>` +
        `<li><b>When:</b> ${Utilities.formatDate(startDate, TIMEZONE, "EEE, MMM d, yyyy h:mm a")} – ${Utilities.formatDate(endDate, TIMEZONE, "h:mm a")}</li>` +
        `<li><b>Where:</b> ${venue}</li>` +
        (position ? `<li><b>Position:</b> ${position}</li>` : ``) +
        `</ul>` +
        `<p>The attached <code>invite.ics</code> file will add this to your calendar (Apple, Outlook, etc.).</p>` +
        `<p>If you can't make it, please let the organizer know ASAP.</p>` +
        `<p>— Dreamers Volleyball Club</p>`,
      attachments: [icsBlob],
      name: "Dreamers Volleyball Club"
    });
  }

  Logger.log(`Invite sent to ${responderEmail} (Google user: ${isGoogleUser}, event ID: ${event.getId()})`);
}

/* ==================================
   STEP B — AUTO-ADD TEAM MEMBERS TO GAME SHEET
================================== */

function addTeamMembersToGameSheet({ submittedRowIndex, submittedRow, headers, submittedPosition, scheduleOption }) {
  const positionCol = headers.findIndex(h => String(h).toLowerCase().includes("position")) + 1;

  if (positionCol === 0) {
    Logger.log("Position column not found.");
    return;
  }

  // Find the matching game sheet (sanitized the same way syncGameSystem does)
  const safeName = String(scheduleOption).replace(/[\\\/\?\*\[\]]/g, "").substring(0, 99);
  const gameSheet = ss.getSheetByName(safeName);

  if (!gameSheet) {
    Logger.log(`Game sheet not found: "${safeName}". Run syncGameSystem first?`);
    return;
  }

  // Full team composition (6 players total)
  const fullTeam = {
    "Open Spiker": 2,
    "Opposite Spiker": 1,
    "Middle Blocker": 2,
    "Setter": 1
  };

  // Subtract the submitter's own position
  const remaining = Object.assign({}, fullTeam);
  if (remaining[submittedPosition] !== undefined) {
    remaining[submittedPosition] -= 1;
  }

  // Build new rows (clone of submitted row, only Position differs)
  const newRows = [];
  for (const [pos, count] of Object.entries(remaining)) {
    for (let i = 0; i < count; i++) {
      const newRow = [...submittedRow];
      newRow[positionCol - 1] = pos;
      newRows.push(newRow);
    }
  }

  if (newRows.length === 0) return;

  // --- Find target row on the GAME SHEET ---
  // Looks for a block of consecutive empty rows large enough to hold all newRows,
  // so existing data anywhere below TEAM_START_ROW is never overwritten.
  const numCols = submittedRow.length;
  const targetRow = findConsecutiveEmptyRows(gameSheet, TEAM_START_ROW, numCols, newRows.length);

  // Ensure enough rows exist on the game sheet
  const rowsNeeded = targetRow + newRows.length;
  if (rowsNeeded > gameSheet.getMaxRows()) {
    gameSheet.insertRowsAfter(gameSheet.getMaxRows(), rowsNeeded - gameSheet.getMaxRows());
  }

  // Write team rows on the game sheet
  gameSheet.getRange(targetRow, 1, newRows.length, numCols).setValues(newRows);

  // Pick a color for THIS team (looking at the game sheet's existing colors)
  const teamColor = pickTeamColor(gameSheet, numCols, TEAM_START_ROW, targetRow);

  // Highlight the new rows on the game sheet
  gameSheet.getRange(targetRow, 1, newRows.length, numCols).setBackground(teamColor);

  // Also highlight the submitter's row on Form Responses 1 (so it's visually marked as a team)
  responseSheet.getRange(submittedRowIndex, 1, 1, responseSheet.getLastColumn()).setBackground(teamColor);

  Logger.log(`Added ${newRows.length} team members to "${safeName}" starting at row ${targetRow} with color ${teamColor}.`);
}

/**
 * Finds the first row at or after `fromRow` where `rowsNeeded` consecutive
 * empty rows exist. Guarantees no existing data is overwritten when writing
 * a multi-row block. Falls back to appending at the bottom if no gap fits.
 */
function findConsecutiveEmptyRows(sheet, fromRow, numCols, rowsNeeded) {
  const maxRow = sheet.getMaxRows();
  if (maxRow < fromRow) return fromRow;

  const data = sheet.getRange(fromRow, 1, maxRow - fromRow + 1, numCols).getValues();

  let runStart = -1;
  let runLength = 0;

  for (let i = 0; i < data.length; i++) {
    const isEmpty = data[i].every(cell => cell === "" || cell === null);

    if (isEmpty) {
      if (runStart === -1) runStart = i;
      runLength++;

      if (runLength >= rowsNeeded) {
        return fromRow + runStart;
      }
    } else {
      // Non-empty row breaks the streak — reset
      runStart = -1;
      runLength = 0;
    }
  }

  // No gap big enough found — append after the last scanned row
  return fromRow + data.length;
}

/**
 * Picks a color that differs from the immediately preceding team block.
 */
function pickTeamColor(sheet, numCols, teamStartRow, targetRow) {
  if (targetRow <= teamStartRow) return TEAM_COLORS[0];

  const prevRowBg = sheet.getRange(targetRow - 1, 1, 1, numCols).getBackgrounds()[0];
  const prevColor = prevRowBg[0];

  const prevIndex = TEAM_COLORS.findIndex(
    c => c.toLowerCase() === String(prevColor).toLowerCase()
  );

  const nextIndex = (prevIndex + 1) % TEAM_COLORS.length;
  return TEAM_COLORS[nextIndex];
}

/* ==================================
   HELPERS
================================== */

function isLikelyGoogleAccount(email) {
  const domain = email.split("@")[1]?.toLowerCase();
  const googleDomains = ["gmail.com", "googlemail.com"];
  const knownWorkspaceDomains = []; // e.g. ["dreamersvc.com"]
  return googleDomains.includes(domain) || knownWorkspaceDomains.includes(domain);
}

function buildICS(opts) {
  const formatManila = (d) => Utilities.formatDate(d, TIMEZONE, "yyyyMMdd'T'HHmmss");
  const formatUTC = (d) => Utilities.formatDate(d, "Etc/UTC", "yyyyMMdd'T'HHmmss'Z'");

  const esc = (s) => String(s)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");

  const now = new Date();

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Dreamers Volleyball Club//Apps Script//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VTIMEZONE",
    "TZID:Asia/Manila",
    "BEGIN:STANDARD",
    "DTSTART:19700101T000000",
    "TZOFFSETFROM:+0800",
    "TZOFFSETTO:+0800",
    "TZNAME:PHT",
    "END:STANDARD",
    "END:VTIMEZONE",
    "BEGIN:VEVENT",
    `UID:${opts.uid}`,
    `DTSTAMP:${formatUTC(now)}`,
    `DTSTART;TZID=Asia/Manila:${formatManila(opts.startDate)}`,
    `DTEND;TZID=Asia/Manila:${formatManila(opts.endDate)}`,
    `SUMMARY:${esc(opts.title)}`,
    `DESCRIPTION:${esc(opts.description)}`,
    `LOCATION:${esc(opts.location)}`,
    `ORGANIZER;CN=Dreamers Volleyball Club:mailto:${opts.organizerEmail}`,
    `ATTENDEE;CN=${opts.attendeeEmail};RSVP=TRUE;PARTSTAT=NEEDS-ACTION;ROLE=REQ-PARTICIPANT:mailto:${opts.attendeeEmail}`,
    "STATUS:CONFIRMED",
    "SEQUENCE:0",
    "TRANSP:OPAQUE",
    "END:VEVENT",
    "END:VCALENDAR"
  ];

  return lines.join("\r\n");
}

function parseDateTime(dateStr, timeStr) {
  const [mm, dd, yy] = dateStr.split("-").map(Number);
  const fullYear = 2000 + yy;

  const timeMatch = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!timeMatch) return null;

  let hours = parseInt(timeMatch[1], 10);
  const minutes = parseInt(timeMatch[2], 10);
  const meridiem = timeMatch[3].toUpperCase();

  if (meridiem === "PM" && hours !== 12) hours += 12;
  if (meridiem === "AM" && hours === 12) hours = 0;

  // Build a date string and parse it explicitly in Manila timezone
  const dateString = Utilities.formatString(
    "%04d-%02d-%02d %02d:%02d:00",
    fullYear, mm, dd, hours, minutes
  );
  return Utilities.parseDate(dateString, TIMEZONE, "yyyy-MM-dd HH:mm:ss");
}

/* ==================================
   ONE-TIME SETUP
================================== */

function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === "onFormSubmit") {
      ScriptApp.deleteTrigger(t);
    }
  });

  ScriptApp.newTrigger("onFormSubmit")
    .forSpreadsheet(ss)
    .onFormSubmit()
    .create();

  Logger.log("onFormSubmit trigger installed on spreadsheet.");
}

/* ==================================
   DVC APP NOTIFICATION
   Configure DVC_APP_URL and DVC_WEBHOOK_SECRET in Script Properties.
================================== */
function notifyDvcApp(scheduleOption) {
  const properties = PropertiesService.getScriptProperties();
  const appUrl = (properties.getProperty("DVC_APP_URL") || "").replace(/\/+$/, "");
  const secret = properties.getProperty("DVC_WEBHOOK_SECRET");
  if (!/^https:\/\/[^/]+/.test(appUrl) || !secret) {
    throw new Error("Set an HTTPS DVC_APP_URL and DVC_WEBHOOK_SECRET in Script Properties.");
  }
  if (!scheduleOption) throw new Error("No game schedule available for the notification.");

  let lastFailure = "network failure";
  for (let attempt = 0; attempt < 3; attempt++) {
    let status = null;
    try {
      const response = UrlFetchApp.fetch(appUrl + "/api/registrations/updated", {
        method: "post",
        contentType: "application/json",
        headers: { "x-registration-key": secret },
        payload: JSON.stringify({
          spreadsheetId: ss.getId(),
          scheduleOption: String(scheduleOption)
        }),
        muteHttpExceptions: true,
        followRedirects: false
      });
      status = response.getResponseCode();
    } catch (_) {
      // Do not print request headers, secrets, or response bodies.
    }
    if (status >= 200 && status < 300) return;
    lastFailure = status === null ? "network failure" : "HTTP " + status;
    // Retry temporary failures only. Repeating a notification is safe.
    if (status !== null && status !== 429 && status < 500) break;
    if (attempt < 2) Utilities.sleep(1000 * Math.pow(2, attempt) + Math.floor(Math.random() * 250));
  }
  throw new Error("Notification unsuccessful: " + lastFailure);
}

// Run once from the editor to authorize UrlFetchApp and test the connection.
// This does not submit a form, add players, or send invitations.
function testDvcWebhook() {
  const row = scheduleSheet.getDataRange().getValues().slice(1)
    .find(r => r[0] && r[1] && r[2]);
  if (!row) throw new Error("No game available in Game Schedule.");
  const date = Utilities.formatDate(new Date(row[0]), TIMEZONE, "MM-dd-yy");
  const day = Utilities.formatDate(new Date(row[0]), TIMEZONE, "EEE");
  notifyDvcApp(`${date} - ${row[1]} (${day}, ${row[2]})`);
  Logger.log("DVC webhook connection succeeded.");
}
