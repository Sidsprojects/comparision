require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { Parser } = require('node-sql-parser');

const parser = new Parser();

/* ===============================
   CONFIG
=============================== */

const BACKUP_FILE = 'backup.sql'; // OLD procedures

const OUTPUT_FOLDER = 'modified_procs';
const OUTPUT_LIST = 'modified_procedures.txt';

const DB_CONFIG = {
    host: 'localhost',
    user: 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
};

/* =====================================
   Format Procedure for Deployment
===================================== */

function formatProcedure(procName, createSQL) {

    // Remove DEFINER if present (recommended)
    createSQL = createSQL.replace(
        /CREATE\s+DEFINER=`[^`]+`@`[^`]+`\s+PROCEDURE/i,
        'CREATE PROCEDURE'
    );

    return `
DROP PROCEDURE IF EXISTS \`${procName}\`;
DELIMITER $$

${createSQL} $$

DELIMITER ;
`.trim();
}


function extractProcedures(sqlContent) {
    const procedures = {};
    const regex = /create\s+procedure\s+`?(\w+)`?[\s\S]*?end\s*[$;]+/gi;

    let match;
    while ((match = regex.exec(sqlContent)) !== null) {
        procedures[match[1]] = match[0];
    }

    return procedures;
}

function convertToAST(sql) {
    try {
        const ast = parser.astify(sql, { database: 'mysql' });

        return JSON.stringify(ast, (key, value) => {
            if (key === 'loc') return undefined;
            return value;
        });

    } catch {
        return sql
            .replace(/--.*$/gm, '')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }
}

async function getProcedureFromDB(connection, procName) {
    const [rows] = await connection.query(
        `SHOW CREATE PROCEDURE \`${procName}\``
    );

    if (!rows.length) return null;

    return rows[0]['Create Procedure'];
}

/* =====================================
   Compare OLD Backup vs NEW DB
===================================== */

async function compareProcedures(oldProcs, procNames) {

    const connection = await mysql.createConnection(DB_CONFIG);

    const modified = [];
    const dbProcedures = {};

    for (const name of procNames) {
        try {
            const newProc = await getProcedureFromDB(connection, name);

            // Procedure deleted in DB
            if (!newProc) {
                console.log(`Deleted in DB: ${name}`);
                modified.push(name);
                continue;
            }

            const oldAST = convertToAST(oldProcs[name]);
            const newAST = convertToAST(newProc);

            if (oldAST !== newAST) {
                console.log(`Modified: ${name}`);
                modified.push(name);
                dbProcedures[name] = newProc; // Save NEW version
            }

        } catch (err) {
            console.log(`Error for ${name}: ${err.message}`);
        }
    }

    await connection.end();

    return { modified, dbProcedures };
}


/* =====================================
   Save Modified (NEW DB VERSION)
===================================== */

function saveResults(modifiedList, dbProcedures) {

    if (!fs.existsSync(OUTPUT_FOLDER)) {
        fs.mkdirSync(OUTPUT_FOLDER);
    }

    fs.writeFileSync(OUTPUT_LIST, modifiedList.join('\n'));

    modifiedList.forEach(name => {
        const filePath = path.join(OUTPUT_FOLDER, `${name}.sql`);

        const formattedSQL = formatProcedure(name, dbProcedures[name]);

        fs.writeFileSync(filePath, formattedSQL);
    });
}


async function main() {

    console.log('Reading OLD backup...');
    const relPath = path.join(__dirname,process.argv[2])
    const backupContent = fs.readFileSync(relPath, 'utf8');

    const oldProcs = extractProcedures(backupContent);
    const procNames = Object.keys(oldProcs);

    console.log(`Old procedures found: ${procNames.length}`);
    const { modified, dbProcedures } =
        await compareProcedures(oldProcs, procNames);

    saveResults(modified, dbProcedures);

    console.log('==============================');
    console.log(`Modified procedures: ${modified.length}`);
    console.log(`List saved: ${OUTPUT_LIST}`);
    console.log(`New SQL saved in: ${OUTPUT_FOLDER}`);
    console.log('==============================');
}

main();
