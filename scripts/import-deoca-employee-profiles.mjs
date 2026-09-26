import { existsSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import XLSX from 'xlsx'
import { findDeocaPunchHeader, parseDeocaPunchSheet } from '../src/utils/deocaPunchImport.js'

const COMPANY_ID = '00000000-0000-0000-0000-000000000031'
const SUPABASE_HOST = 'abghublsyvuyangkyibz.supabase.co'
const [filePath, mode = '--dry-run'] = process.argv.slice(2)

if (!filePath || !existsSync(filePath) || !['--dry-run', '--apply'].includes(mode)) {
  throw new Error('Cách dùng: node scripts/import-deoca-employee-profiles.mjs <file.xlsx> [--dry-run|--apply]')
}

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!supabaseUrl || !serviceRoleKey || new URL(supabaseUrl).hostname !== SUPABASE_HOST) {
  throw new Error('Thiếu service role key hoặc sai Supabase project dùng chung của HR31.')
}

const workbook = XLSX.readFile(filePath)
const matches = workbook.SheetNames.map(name => {
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[name], {
    header: 1,
    raw: false,
    defval: ''
  })
  return { name, rows, header: findDeocaPunchHeader(rows) }
}).filter(sheet => sheet.header)
if (matches.length !== 1) {
  throw new Error(`Cần đúng một sheet theo định dạng DEOCA; tìm được ${matches.length}.`)
}

const sheet = matches[0]
const { records, skipped } = parseDeocaPunchSheet(sheet.rows, sheet.header)
if (skipped.length) throw new Error(`File có ${skipped.length} dòng thiếu ID/ngày hợp lệ; dừng để kiểm tra.`)

const normalize = value => String(value ?? '').replace(/\s+/g, ' ').trim()
const employees = new Map()
for (const record of records) {
  // File thực tế đặt họ ở cột "Tên riêng" và phần tên còn lại ở cột "Họ".
  // Giữ đúng thứ tự hiển thị từ nguồn: cột A rồi cột B.
  const code = normalize(record.employee_code)
  const name = normalize(`${record.first_name} ${record.last_name}`)
  const department = normalize(record.department_location)
  if (!code || !normalize(record.first_name) || !normalize(record.last_name) || !department) {
    throw new Error(`Dòng ${record.source_row} thiếu mã, tên hoặc bộ phận.`)
  }
  const previous = employees.get(code)
  if (previous && (previous.name !== name || previous.department !== department)) {
    throw new Error(`Mã ${code} có tên hoặc bộ phận không thống nhất trong file.`)
  }
  employees.set(code, { code, name, department })
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false }
})
const [usersResult, personnelResult] = await Promise.all([
  supabase.from('users').select('id,employee_id,name,department').eq('company_id', COMPANY_ID),
  supabase.from('nhan_su').select('id,ma_nhan_vien,ho_ten,bo_phan').eq('company_id', COMPANY_ID)
])
if (usersResult.error) throw usersResult.error
if (personnelResult.error) throw personnelResult.error

const usersByCode = new Map(usersResult.data.filter(row => row.employee_id).map(row => [row.employee_id, row]))
const personnelByCode = new Map(personnelResult.data.map(row => [row.ma_nhan_vien, row]))
for (const employee of employees.values()) {
  const user = usersByCode.get(employee.code)
  const person = personnelByCode.get(employee.code)
  if (user && (normalize(user.name) !== employee.name || normalize(user.department) !== employee.department)) {
    throw new Error(`Hồ sơ users của mã ${employee.code} khác file; không ghi đè.`)
  }
  if (person && (normalize(person.ho_ten) !== employee.name || normalize(person.bo_phan) !== employee.department)) {
    throw new Error(`Hồ sơ nhan_su của mã ${employee.code} khác file; không ghi đè.`)
  }
}

const missingUsers = [...employees.values()].filter(employee => !usersByCode.has(employee.code))
const missingPersonnel = [...employees.values()].filter(employee => !personnelByCode.has(employee.code))
console.log(JSON.stringify({
  sheet: sheet.name,
  headerRow: sheet.header.rowIndex + 1,
  sourceRecords: records.length,
  uniqueEmployees: employees.size,
  existingUserProfiles: usersResult.data.length,
  existingPersonnelProfiles: personnelResult.data.length,
  usersToCreate: missingUsers.length,
  personnelToCreate: missingPersonnel.length,
  mode
}))
if (mode === '--apply') {
  let createdUsers = []
  if (missingUsers.length) {
    const { data, error } = await supabase.from('users').insert(missingUsers.map(employee => ({
      company_id: COMPANY_ID,
      employee_id: employee.code,
      username: employee.code,
      name: employee.name,
      department: employee.department,
      employment_status: '',
      role: 'user'
    }))).select('id,employee_id')
    if (error) throw error
    createdUsers = data
  }

  if (missingPersonnel.length) {
    const { error } = await supabase.from('nhan_su').insert(missingPersonnel.map(employee => ({
      company_id: COMPANY_ID,
      ma_nhan_vien: employee.code,
      ho_ten: employee.name,
      bo_phan: employee.department,
      ca_lam: '',
      trang_thai: ''
    })))
    if (error) {
      if (createdUsers.length) {
        const rollback = await supabase.from('users').delete()
          .eq('company_id', COMPANY_ID)
          .in('id', createdUsers.map(row => row.id))
        if (rollback.error) throw new Error(`Tạo nhan_su lỗi: ${error.message}; hoàn tác users cũng lỗi: ${rollback.error.message}`)
      }
      throw error
    }
  }

  const [usersAfter, personnelAfter] = await Promise.all([
    supabase.from('users').select('employee_id,name,department').eq('company_id', COMPANY_ID),
    supabase.from('nhan_su').select('ma_nhan_vien,ho_ten,bo_phan').eq('company_id', COMPANY_ID)
  ])
  if (usersAfter.error) throw usersAfter.error
  if (personnelAfter.error) throw personnelAfter.error
  for (const employee of employees.values()) {
    if (!usersAfter.data.some(row => row.employee_id === employee.code && row.name === employee.name && row.department === employee.department)) {
      throw new Error(`Không xác minh được hồ sơ users của ${employee.code}.`)
    }
    if (!personnelAfter.data.some(row => row.ma_nhan_vien === employee.code && row.ho_ten === employee.name && row.bo_phan === employee.department)) {
      throw new Error(`Không xác minh được hồ sơ nhan_su của ${employee.code}.`)
    }
  }
  console.log(JSON.stringify({
    createdUsers: createdUsers.length,
    createdPersonnel: missingPersonnel.length,
    verifiedEmployees: employees.size,
    usersTotalIncludingAdmin: usersAfter.data.length,
    personnelTotal: personnelAfter.data.length
  }))
}
