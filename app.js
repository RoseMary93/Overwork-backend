const path = require("path");
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const jwt = require("jsonwebtoken");
const { google } = require("googleapis");

dotenv.config({ path: path.join(__dirname, ".env") });

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const SHEET_ID =
  process.env.GOOGLE_SHEET_ID || "1MeCb_ClcxP-H_e6vYid49l-ayRd0cF-TE_StXRO9dnM";

// ===== Users Sheet Configuration =====
const USERS_SHEET_RANGE = "'users'!A:D";
const USERS_COLUMNS = ["id", "username", "password", "display_name"];

// ===== Worklogs Sheet Configuration =====
const WORKLOGS_SHEET_RANGE = "'worklogs'!A:F";
const WORKLOGS_COLUMNS = [
  "id",
  "user_id",
  "date",
  "duration_hours",
  "reason",
  "notes",
];

const JWT_SECRET = process.env.JWT_SECRET || "change-me-secret";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "365d";

/**
 * Reuse the Google Sheets client so we do not re-authenticate on every request.
 */
const buildCredentialsFromEnv = () => {
  const requiredKeys = [
    "GOOGLE_SA_TYPE",
    "GOOGLE_SA_PROJECT_ID",
    "GOOGLE_SA_PRIVATE_KEY_ID",
    "GOOGLE_SA_PRIVATE_KEY",
    "GOOGLE_SA_CLIENT_EMAIL",
    "GOOGLE_SA_CLIENT_ID",
  ];

  const hasAll = requiredKeys.every((key) => !!process.env[key]);
  if (!hasAll) {
    return null;
  }

  return {
    type: process.env.GOOGLE_SA_TYPE,
    project_id: process.env.GOOGLE_SA_PROJECT_ID,
    private_key_id: process.env.GOOGLE_SA_PRIVATE_KEY_ID,
    private_key: process.env.GOOGLE_SA_PRIVATE_KEY.replace(/\\n/g, "\n"),
    client_email: process.env.GOOGLE_SA_CLIENT_EMAIL,
    client_id: process.env.GOOGLE_SA_CLIENT_ID,
  };
};

const getSheetsClient = (() => {
  let cached;
  return () => {
    if (cached) return cached;

    const credentials = buildCredentialsFromEnv();
    const auth = new google.auth.GoogleAuth({
      ...(credentials
        ? { credentials }
        : {
          keyFile:
            process.env.GOOGLE_APPLICATION_CREDENTIALS ||
            path.join(
              __dirname,
              "sunlit-adviser-479406-r0-b5a712496697.json"
            ),
        }),
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    cached = google.sheets({ version: "v4", auth });
    return cached;
  };
})();

// ===== Helper Functions =====

const normalizeRows = (rows) => {
  if (!rows || rows.length === 0) {
    return [];
  }

  const [header, ...dataRows] = rows;
  return dataRows.map((row) =>
    header.reduce((acc, key, index) => {
      acc[key] = row[index] ?? "";
      return acc;
    }, {})
  );
};

const appendRow = async (sheets, range, columns, payload) => {
  const row = columns.map((key) => {
    const value = payload[key];
    return value === undefined || value === null ? "" : value;
  });

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [row],
    },
  });
};

const findRowById = async (sheetRange, idColumn, targetId) => {
  const sheets = getSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: sheetRange,
  });

  const rows = response.data.values || [];
  if (rows.length < 2) return null;

  const [header, ...dataRows] = rows;
  const idIndex = header.indexOf(idColumn);
  if (idIndex === -1) return null;

  const normalizedTarget = (targetId ?? "").toString().trim();
  for (let i = 0; i < dataRows.length; i++) {
    const rowId = (dataRows[i][idIndex] ?? "").toString().trim();
    if (rowId === normalizedTarget) {
      const rowData = header.reduce((acc, key, idx) => {
        acc[key] = dataRows[i][idx] ?? "";
        return acc;
      }, {});
      return { rowIndex: i + 2, rowData }; // +2: 1 for 1-based, 1 for header
    }
  }
  return null;
};

const updateRow = async (sheetName, rowIndex, columns, payload) => {
  const sheets = getSheetsClient();
  const row = columns.map((key) => {
    const value = payload[key];
    return value === undefined || value === null ? "" : value;
  });

  const range = `'${sheetName}'!A${rowIndex}:${String.fromCharCode(
    64 + columns.length
  )}${rowIndex}`;
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [row],
    },
  });
};

const deleteRow = async (sheetName, rowIndex) => {
  const sheets = getSheetsClient();

  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId: SHEET_ID,
  });

  const sheet = spreadsheet.data.sheets.find(
    (s) => s.properties.title === sheetName
  );
  if (!sheet) {
    throw new Error(`找不到工作表: ${sheetName}`);
  }

  const sheetId = sheet.properties.sheetId;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId,
              dimension: "ROWS",
              startIndex: rowIndex - 1,
              endIndex: rowIndex,
            },
          },
        },
      ],
    },
  });
};

const getAllRows = async (range) => {
  const sheets = getSheetsClient();
  const response = await sheets.spreadsheets.values
    .get({
      spreadsheetId: SHEET_ID,
      range: range,
    })
    .catch((error) => {
      // If sheet doesn't exist yet, return empty
      if (error.code === 400 || error.code === 404) {
        return { data: { values: [] } };
      }
      throw error;
    });
  return normalizeRows(response.data.values);
};

const initializeSheet = async (sheets, range, columns) => {
  // Check if header exists
  const response = await sheets.spreadsheets.values
    .get({
      spreadsheetId: SHEET_ID,
      range: range, // Just check the first row ideally, but this is simple
    })
    .catch(() => ({ data: { values: [] } }));

  const rows = response.data.values || [];
  if (rows.length === 0) {
    // Write header
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: range.split("!")[0] + "!A1",
      valueInputOption: "RAW",
      requestBody: {
        values: [columns],
      },
    });
  }
};

// ===== Auth Middleware =====

const generateToken = (payload) =>
  jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

const requireAuth = (req, res, next) => {
  const header = req.header("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ message: "未授權：請提供 token" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ message: "token 無效或已過期" });
  }
};

// ===== Endpoints =====

app.get("/", (req, res) => {
  res.json({
    message: "Google Sheets Overwork Tracker API",
    status: "ok",
  });
});

// Init sheets on startup (lazy init when endpoints hit is also fine, but this helps)
// We won't block startup but it's good practice to ensure headers exist
const initSheets = async () => {
  try {
    const sheets = getSheetsClient();
    await initializeSheet(sheets, USERS_SHEET_RANGE, USERS_COLUMNS);
    await initializeSheet(sheets, WORKLOGS_SHEET_RANGE, WORKLOGS_COLUMNS);
    console.log("Sheets initialized/verified");
  } catch (e) {
    console.error("Error initializing sheets:", e.message);
  }
};
initSheets();

// Register
app.post("/auth/register", async (req, res) => {
  try {
    const { username, password, display_name } = req.body;
    if (!username || !password) {
      return res.status(400).json({ message: "請提供帳號與密碼" });
    }

    const users = await getAllRows(USERS_SHEET_RANGE);
    const exists = users.some((u) => u.username === username);
    if (exists) {
      return res.status(409).json({ message: "帳號已重覆" });
    }

    const sheets = getSheetsClient();
    const newUser = {
      id: `user-${Date.now()}`,
      username,
      password, // Note: In production, hash this!
      display_name: display_name || username,
    };

    await appendRow(sheets, USERS_SHEET_RANGE, USERS_COLUMNS, newUser);

    const token = generateToken({
      id: newUser.id,
      username: newUser.username,
      display_name: newUser.display_name,
    });

    res.status(201).json({
      message: "註冊成功",
      token,
      user: {
        id: newUser.id,
        username: newUser.username,
        display_name: newUser.display_name,
      },
    });
  } catch (error) {
    console.error("Register error:", error);
    res.status(500).json({ message: "註冊失敗", error: error.message });
  }
});

// Login
app.post("/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ message: "請提供帳號與密碼" });
    }

    const users = await getAllRows(USERS_SHEET_RANGE);
    const user = users.find(
      (u) => u.username === username && u.password === password
    );

    if (!user) {
      return res.status(401).json({ message: "帳號或密碼錯誤" });
    }

    const token = generateToken({
      id: user.id,
      username: user.username,
      display_name: user.display_name,
    });

    res.json({
      message: "登入成功",
      token,
      user: {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
      },
      expiresIn: JWT_EXPIRES_IN,
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ message: "登入失敗", error: error.message });
  }
});

// Worklogs CRUD

// Get my worklogs
app.get("/api/worklogs", requireAuth, async (req, res) => {
  try {
    const worklogs = await getAllRows(WORKLOGS_SHEET_RANGE);
    const myLogs = worklogs
      .filter((log) => log.user_id === req.user.id)
      .map((log) => ({
        ...log,
        duration_hours: Number(log.duration_hours),
      }));

    // Sort by date desc
    myLogs.sort((a, b) => new Date(b.date) - new Date(a.date));

    res.json({ data: myLogs });
  } catch (error) {
    console.error("Fetch worklogs error:", error);
    res.status(500).json({ message: "無法讀取紀錄", error: error.message });
  }
});

// Create worklog
app.post("/api/worklogs", requireAuth, async (req, res) => {
  try {
    const { date, duration_hours, reason, notes } = req.body;
    if (!date || !duration_hours || !reason) {
      return res.status(400).json({ message: "缺少必要欄位 (日期、時數、原因)" });
    }

    const payload = {
      id: `log-${Date.now()}`,
      user_id: req.user.id,
      date,
      duration_hours,
      reason,
      notes: notes || "",
    };

    const sheets = getSheetsClient();
    await appendRow(sheets, WORKLOGS_SHEET_RANGE, WORKLOGS_COLUMNS, payload);

    res.status(201).json({ message: "紀錄新增成功", data: payload });
  } catch (error) {
    console.error("Create worklog error:", error);
    res.status(500).json({ message: "無法新增紀錄", error: error.message });
  }
});

// Update worklog
app.put("/api/worklogs/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const found = await findRowById(WORKLOGS_SHEET_RANGE, "id", id);

    if (!found) {
      return res.status(404).json({ message: "找不到該筆紀錄" });
    }

    if (found.rowData.user_id !== req.user.id) {
      return res.status(403).json({ message: "無權修改此紀錄" });
    }

    const payload = {
      ...found.rowData,
      ...req.body,
      id, // ensure id not changed
      user_id: req.user.id, // ensure owner not changed
    };

    await updateRow("worklogs", found.rowIndex, WORKLOGS_COLUMNS, payload);

    res.json({ message: "紀錄更新成功", data: payload });
  } catch (error) {
    console.error("Update worklog error:", error);
    res.status(500).json({ message: "無法更新紀錄", error: error.message });
  }
});

// Delete worklog
app.delete("/api/worklogs/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const found = await findRowById(WORKLOGS_SHEET_RANGE, "id", id);

    if (!found) {
      return res.status(404).json({ message: "找不到該筆紀錄" });
    }

    if (found.rowData.user_id !== req.user.id) {
      return res.status(403).json({ message: "無權刪除此紀錄" });
    }

    await deleteRow("worklogs", found.rowIndex);

    res.json({ message: "紀錄刪除成功", data: found.rowData });
  } catch (error) {
    console.error("Delete worklog error:", error);
    res.status(500).json({ message: "無法刪除紀錄", error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
