import { supabase } from './supabase'
import { fbGet, fbSet } from './firebase'
import { mapUserToApp } from '../utils/helpers'
import { normalizeLeaveData } from '../utils/employeeLeave'

const PAGE_SIZE = 1000

export const loadLeaveEmployees = async companyId => {
  if (!companyId) throw new Error('Thiếu mã công ty.')
  const rows = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase.from('users')
      .select('id, employee_id, name, join_date, employment_status, role, company_id')
      .eq('company_id', companyId)
      .order('name', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw error
    rows.push(...(data || []))
    if (!data || data.length < PAGE_SIZE) break
  }
  return rows.map(mapUserToApp).sort((a, b) => a.ho_va_ten.localeCompare(b.ho_va_ten, 'vi'))
}

export const loadEmployeeLeaveSettings = async companyId => {
  if (!companyId) throw new Error('Thiếu mã công ty.')
  const stored = await fbGet('hr/employeeLeaveSettings', companyId)
  return Object.fromEntries(Object.entries(stored || {}).map(([id, value]) => [
    id, normalizeLeaveData(value?.leave_data ?? value)
  ]))
}

export const saveEmployeeLeaveSettings = async (companyId, employeeId, leaveData) => {
  if (!companyId || !employeeId) throw new Error('Thiếu mã công ty hoặc nhân sự.')
  const normalized = normalizeLeaveData(leaveData)
  await fbSet(`hr/employeeLeaveSettings/${employeeId}`, normalized, companyId)
  return normalized
}
