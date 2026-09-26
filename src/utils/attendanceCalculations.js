import {
  attendanceTimeToMinutes,
  DEFAULT_ATTENDANCE_SETTINGS,
  normalizeAttendanceShiftSettings
} from './attendanceShift.js'

/**
 * Một ngày công đủ được quy đổi từ chuẩn phút làm việc theo cấu hình (mặc định 480 phút).
 * Không dùng số giờ đã làm tròn từ Excel để tính lại tổng tháng.
 */
export const STANDARD_WORK_MINUTES = 8 * 60

const finiteNumber = (value, fallback = 0) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export const roundDecimal = (value, digits = 2) => {
  const factor = 10 ** digits
  return Math.round((finiteNumber(value) + Number.EPSILON) * factor) / factor
}

const firstPresent = (...values) =>
  values.find(value => value !== null && value !== undefined && String(value).trim() !== '')

/**
 * Tính số phút trùng lặp giữa khoảng thời gian có mặt và khung giờ làm việc.
 */
export const calculateOverlapMinutes = (actualStart, actualEnd, shiftStart, shiftEnd) => {
  if (
    actualStart === null || actualStart === undefined ||
    actualEnd === null || actualEnd === undefined ||
    shiftStart === null || shiftStart === undefined ||
    shiftEnd === null || shiftEnd === undefined
  ) return 0

  const start = Math.max(actualStart, shiftStart)
  const end = Math.min(actualEnd, shiftEnd)
  return end > start ? end - start : 0
}

/**
 * Giờ vào sớm hơn giờ bắt đầu làm (workStart) được tự động quy về workStart.
 */
export const calculateEffectiveCheckIn = (checkIn, workStart = DEFAULT_ATTENDANCE_SETTINGS.workStart) => {
  const inMinutes = attendanceTimeToMinutes(checkIn)
  const workStartMinutes = attendanceTimeToMinutes(workStart)
  if (inMinutes === null) return null
  if (workStartMinutes === null) return checkIn
  return inMinutes < workStartMinutes ? workStart : checkIn
}

/**
 * Tính số phút làm việc công thường theo 2 khoảng:
 * - Khoảng sáng: workStart → lunchStart
 * - Khoảng chiều: lunchEnd → workEnd
 * Khoảng nghỉ trưa (lunchStart → lunchEnd) không tính công.
 */
export const calculateRegularMinutes = ({
  checkIn,
  checkOut,
  workStart = DEFAULT_ATTENDANCE_SETTINGS.workStart,
  lunchStart = DEFAULT_ATTENDANCE_SETTINGS.lunchStart,
  lunchEnd = DEFAULT_ATTENDANCE_SETTINGS.lunchEnd,
  workEnd = DEFAULT_ATTENDANCE_SETTINGS.workEnd
} = {}) => {
  const effectiveIn = calculateEffectiveCheckIn(checkIn, workStart)
  const effectiveInMinutes = attendanceTimeToMinutes(effectiveIn)
  const outMinutes = attendanceTimeToMinutes(checkOut)
  if (effectiveInMinutes === null || outMinutes === null) return 0
  if (outMinutes <= effectiveInMinutes) return 0

  const startMins = attendanceTimeToMinutes(workStart)
  const lunchStartMins = attendanceTimeToMinutes(lunchStart)
  const lunchEndMins = attendanceTimeToMinutes(lunchEnd)
  const endMins = attendanceTimeToMinutes(workEnd)

  const morningMinutes = calculateOverlapMinutes(
    effectiveInMinutes,
    outMinutes,
    startMins,
    lunchStartMins
  )

  const afternoonMinutes = calculateOverlapMinutes(
    effectiveInMinutes,
    outMinutes,
    lunchEndMins,
    endMins
  )

  return morningMinutes + afternoonMinutes
}

/**
 * Tăng ca tự động chỉ tính phần sau giờ kết thúc làm việc (workEnd).
 */
export const calculateAutomaticOvertime = ({
  checkIn,
  checkOut,
  workEnd = DEFAULT_ATTENDANCE_SETTINGS.workEnd
} = {}) => {
  const inMinutes = attendanceTimeToMinutes(checkIn)
  const outMinutes = attendanceTimeToMinutes(checkOut)
  const workEndMinutes = attendanceTimeToMinutes(workEnd)
  if (inMinutes === null || outMinutes === null || workEndMinutes === null) return 0
  if (outMinutes <= inMinutes) return 0

  const otStartMinutes = Math.max(inMinutes, workEndMinutes)
  if (outMinutes > otStartMinutes) {
    return (outMinutes - otStartMinutes) / 60
  }
  return 0
}

/**
 * Tính số phút giữa cặp Vào/Ra. Ca đêm được nối sang ngày kế tiếp thay vì
 * tạo số âm. `breakMinutes` chỉ được trừ khi được cấu hình rõ ràng; mặc định
 * dữ liệu chấm công được tính đúng theo chênh lệch Vào → Ra.
 */
export const calculateWorkedMinutes = ({
  checkIn,
  checkOut,
  breakMinutes = 0
} = {}) => {
  const inMinutes = attendanceTimeToMinutes(checkIn)
  const outMinutes = attendanceTimeToMinutes(checkOut)
  if (inMinutes === null || outMinutes === null) return null

  let elapsed = outMinutes - inMinutes
  if (elapsed < 0) elapsed += 24 * 60
  if (elapsed <= 0) return 0

  const unpaidBreak = Math.max(0, finiteNumber(breakMinutes))
  return Math.max(0, elapsed - unpaidBreak)
}

const manualOvertimeHours = log => {
  const fields = ['tc1', 'tc2', 'tc3']
  const hasManualValue = fields.some(field =>
    log && log[field] !== null && log[field] !== undefined &&
    String(log[field]).trim() !== '' && finiteNumber(log[field]) > 0
  )
  if (!hasManualValue) return { hasValue: false, hours: 0 }

  return {
    hasValue: true,
    hours: Math.max(0, fields.reduce((total, field) => total + finiteNumber(log[field]), 0))
  }
}

const punchInterval = pair => {
  const start = attendanceTimeToMinutes(pair?.checkIn)
  const rawEnd = attendanceTimeToMinutes(pair?.checkOut)
  if (start === null || rawEnd === null) return null
  const end = rawEnd < start ? rawEnd + 24 * 60 : rawEnd
  return end > start ? { start, end, minutes: end - start } : null
}

const sessionInterval = session => {
  const start = attendanceTimeToMinutes(session?.start)
  const rawEnd = attendanceTimeToMinutes(session?.end)
  if (start === null || rawEnd === null) return null
  const end = rawEnd < start ? rawEnd + 24 * 60 : rawEnd
  return end > start ? { start, end, minutes: end - start } : null
}

const coveredMinutes = (intervals, session) => {
  const clipped = intervals
    .map(interval => ({
      start: Math.max(interval.start, session.start),
      end: Math.min(interval.end, session.end)
    }))
    .filter(interval => interval.end > interval.start)
    .sort((left, right) => left.start - right.start)

  let total = 0
  let end = -Infinity
  clipped.forEach(interval => {
    total += Math.max(0, interval.end - Math.max(interval.start, end))
    end = Math.max(end, interval.end)
  })
  return total
}

const normalizePunchPairs = punchPairs => (punchPairs || [])
  .map(pair => ({
    checkIn: firstPresent(pair?.checkIn),
    checkOut: firstPresent(pair?.checkOut)
  }))
  .filter(pair => pair.checkIn || pair.checkOut)

const buildSplitSessions = splitShift => [
  { key: 'morning', label: 'Buổi sáng', ...splitShift?.morning },
  { key: 'afternoon', label: 'Buổi chiều', ...splitShift?.afternoon }
].map(session => ({
  ...session,
  interval: sessionInterval(session),
  workdays: Math.min(1, Math.max(0, finiteNumber(session.workdays, 0.5)))
}))

const calculatePartialSplitSpanWork = ({
  punchPairs = [],
  splitShift
} = {}) => {
  if (!splitShift?.enabled) return null

  const pairs = normalizePunchPairs(punchPairs)
  const hasIncompletePair = pairs.some(pair => Boolean(pair.checkIn) !== Boolean(pair.checkOut))
  if (!hasIncompletePair) return null

  const checkIn = pairs.find(pair => pair.checkIn)?.checkIn
  const checkOut = [...pairs].reverse().find(pair => pair.checkOut)?.checkOut
  if (!checkIn || !checkOut) return null

  return calculateSplitShiftWork({
    punchPairs: [{ checkIn, checkOut }],
    splitShift
  })
}

export const calculateSplitShiftWork = ({ punchPairs = [], splitShift } = {}) => {
  if (!splitShift?.enabled) return null
  const rawPairs = normalizePunchPairs(punchPairs)
  if (rawPairs.some(pair => Boolean(pair.checkIn) !== Boolean(pair.checkOut))) return null

  const sessions = buildSplitSessions(splitShift)
  if (sessions.some(session => !session.interval)) return null

  const pairs = rawPairs.map(punchInterval).filter(Boolean)
  if (!pairs.length) return null
  const breakdown = sessions.map(session => {
    const creditedMinutes = coveredMinutes(pairs, session.interval)
    return {
      key: session.key,
      label: session.label,
      minutes: creditedMinutes,
      workdays: creditedMinutes / session.interval.minutes * session.workdays
    }
  })

  return {
    workedMinutes: breakdown.reduce((total, session) => total + session.minutes, 0),
    regularWorkdays: breakdown.reduce((total, session) => total + session.workdays, 0),
    breakdown
  }
}

/**
 * Tính Công/Giờ/Tăng ca cho một bản ghi.
 *
 * Mô hình mới:
 * - Giờ làm việc và giờ nghỉ trưa được cấu hình trong Cài đặt theo từng công ty.
 * - Giờ vào sớm hơn workStart được tự động quy về workStart (effectiveCheckIn).
 * - Giờ nghỉ trưa (lunchStart → lunchEnd) không tính công.
 * - Tăng ca tự động chỉ tính phần thời gian sau giờ kết thúc làm việc (workEnd).
 * - Ưu tiên tăng ca thủ công (TC1/TC2/TC3) nếu có.
 * - Ngày chỉ có 1 lần chấm (thiếu checkOut) giữ nguyên trạng thái thiếu (0 công), không tự suy luận checkOut.
 */
export const calculateAttendanceMetrics = ({
  log = {},
  checkIn = firstPresent(log.checkIn, log.vao),
  checkOut = firstPresent(log.checkOut, log.ra),
  attendanceSettings = {},
  standardMinutes,
  breakMinutes = 0,
  autoCalculateOvertime = true,
  punchPairs = log.punchPairs,
  splitShift,
  fallbackHours,
  fallbackWorkdays
} = {}) => {
  const resolvedSettings = normalizeAttendanceShiftSettings(
    attendanceSettings?.workStart
      ? attendanceSettings
      : (log?.attendanceSettings?.workStart ? log.attendanceSettings : attendanceSettings)
  )
  const { workStart, lunchStart, lunchEnd, workEnd } = resolvedSettings
  const standard = standardMinutes !== undefined && standardMinutes !== null && Number(standardMinutes) > 0
    ? Number(standardMinutes)
    : resolvedSettings.standardWorkMinutes

  const inMinutes = attendanceTimeToMinutes(checkIn)
  const outMinutes = attendanceTimeToMinutes(checkOut)
  const hasValidPair = inMinutes !== null && outMinutes !== null && outMinutes > inMinutes

  const manual = manualOvertimeHours(log)
  const sourceHours = finiteNumber(
    firstPresent(fallbackHours, log.hours, log.soGio, log.gio),
    0
  )

  if (!hasValidPair) {
    const sourceWorkdays = fallbackWorkdays !== undefined && fallbackWorkdays !== null
      ? Math.max(0, finiteNumber(fallbackWorkdays))
      : Math.min(Math.max(0, sourceHours * 60) / standard, 1)
    return {
      hasPunchPair: false,
      effectiveCheckIn: null,
      checkIn: checkIn || null,
      checkOut: checkOut || null,
      workedMinutes: Math.max(0, sourceHours * 60),
      regularMinutes: Math.min(Math.max(0, sourceHours * 60), standard),
      overtimeMinutes: manual.hasValue ? manual.hours * 60 : 0,
      hours: Math.max(0, sourceHours),
      regularWorkdays: sourceWorkdays,
      overtimeHours: manual.hasValue ? manual.hours : 0,
      overtimeSource: manual.hasValue ? 'manual' : 'none',
      standardWorkMinutes: standard,
      calculationMode: 'source-value'
    }
  }

  // Hỗ trợ cấu hình splitShift phụ nếu có ca riêng biệt
  const resolvedPunchPairs = normalizePunchPairs(punchPairs)
  if (!resolvedPunchPairs.length && checkIn && checkOut) {
    resolvedPunchPairs.push({ checkIn, checkOut })
  }
  const splitMetrics = splitShift?.enabled
    ? (calculatePartialSplitSpanWork({ punchPairs: resolvedPunchPairs, splitShift }) ||
       calculateSplitShiftWork({ punchPairs: resolvedPunchPairs, splitShift }))
    : null

  const effectiveCheckIn = calculateEffectiveCheckIn(checkIn, workStart)
  const regularMinutes = splitMetrics
    ? splitMetrics.workedMinutes
    : calculateRegularMinutes({
        checkIn,
        checkOut,
        workStart,
        lunchStart,
        lunchEnd,
        workEnd
      })

  const automaticAllowed = autoCalculateOvertime && !log.overtimeAutoDisabled
  const autoOvertimeHours = !splitMetrics && automaticAllowed
    ? calculateAutomaticOvertime({
        checkIn,
        checkOut,
        workEnd
      })
    : 0

  const overtimeHours = manual.hasValue
    ? manual.hours
    : autoOvertimeHours

  const regularWorkdays = splitMetrics
    ? splitMetrics.regularWorkdays
    : Math.min(regularMinutes / standard, 1.0)

  const workedMinutes = splitMetrics
    ? splitMetrics.workedMinutes
    : regularMinutes

  return {
    hasPunchPair: true,
    effectiveCheckIn,
    checkIn,
    checkOut,
    workedMinutes,
    regularMinutes,
    overtimeMinutes: overtimeHours * 60,
    hours: regularMinutes / 60,
    regularWorkdays,
    overtimeHours,
    overtimeSource: manual.hasValue ? 'manual' : automaticAllowed ? 'automatic' : 'disabled',
    standardWorkMinutes: standard,
    calculationMode: splitMetrics ? 'split-shift' : 'schedule',
    splitShiftBreakdown: splitMetrics?.breakdown || []
  }
}

export const getAttendanceHoliday = (date, attendanceSettings = {}) => {
  const dateKey = String(date || '').slice(0, 10)
  if (!dateKey) return null
  const holidays = Array.isArray(attendanceSettings?.holidays)
    ? attendanceSettings.holidays
    : []
  return holidays
    .map(item => {
      if (typeof item === 'string') return { date: item.slice(0, 10), name: '' }
      return {
        date: String(item?.date || item?.day || '').slice(0, 10),
        name: String(item?.name || item?.label || '').trim()
      }
    })
    .find(item => item.date === dateKey) || null
}

/**
 * Mô tả công thức công ngày để hiện tooltip / chú thích trên bảng ma trận.
 */
export const describeDayWorkFormula = (day = {}, {
  standardMinutes,
  displayCode = '',
  attendanceSettings = {}
} = {}) => {
  const code = String(displayCode || '').trim().toUpperCase()
  const settings = normalizeAttendanceShiftSettings(attendanceSettings)
  const standard = Math.max(1, finiteNumber(standardMinutes, settings.standardWorkMinutes))
  const checkIn = String(day.checkIn || day.vao || '').trim()
  const checkOut = String(day.checkOut || day.ra || '').trim()
  const regularMinutes = day.regularMinutes !== undefined
    ? finiteNumber(day.regularMinutes)
    : finiteNumber(day.workedMinutes, checkIn && checkOut ? calculateRegularMinutes({ checkIn, checkOut, ...settings }) : finiteNumber(day.hoursExact ?? day.hours) * 60)
  const workdays = finiteNumber(day.workdaysExact ?? day.workdays)
  const holidayLabel = day.holidayName
    ? `Ngày lễ: ${day.holidayName}`
    : (day.isHoliday ? 'Ngày lễ' : '')

  if (day.manualOverride) {
    return `Chỉnh tay: ${roundDecimal(workdays)} công`
  }

  if (code === 'P1' || code === 'P' || finiteNumber(day.paidLeaveWorkdays) > 0) {
    const leave = finiteNumber(day.paidLeaveWorkdays, workdays || 1)
    return `Phép (P1) = ${roundDecimal(leave)} công${holidayLabel ? ` · ${holidayLabel}` : ''}`
  }

  if (day.calculationMode === 'split-shift' && Array.isArray(day.splitShiftBreakdown)) {
    const sessions = day.splitShiftBreakdown.filter(session =>
      finiteNumber(session?.minutes) > 0 || finiteNumber(session?.workdays) > 0
    )
    if (sessions.length) {
      const details = sessions.map(session =>
        `${session.label || 'Buổi'} ${Math.round(finiteNumber(session.minutes))}p = ${roundDecimal(session.workdays)} công`
      )
      return `Chia 2 buổi: ${details.join(' · ')} · Tổng ${roundDecimal(workdays)} công${holidayLabel ? ` · ${holidayLabel}` : ''}`
    }
    return `Ngoài khung giờ hai buổi = 0 công${holidayLabel ? ` · ${holidayLabel}` : ''}`
  }

  if (holidayLabel && workdays <= 0 && !checkIn && !checkOut) {
    return `${holidayLabel} — không tự tính công`
  }

  if (checkIn && checkOut) {
    const cong = roundDecimal(Math.min(regularMinutes / standard, 1), 4)
    const effectiveIn = day.effectiveCheckIn || calculateEffectiveCheckIn(checkIn, settings.workStart)
    const inPart = effectiveIn && effectiveIn !== checkIn ? `${checkIn} (quy về ${effectiveIn})→${checkOut}` : `${checkIn}→${checkOut}`
    const parts = [
      `${inPart}`,
      `Công chuẩn: ${Math.round(regularMinutes)}p ÷ ${standard}p = ${roundDecimal(cong)} công`
    ]
    if (finiteNumber(day.overtimeHours) > 0) {
      parts.push(`Tăng ca: ${roundDecimal(day.overtimeHours)}h`)
    }
    if (holidayLabel) parts.push(holidayLabel)
    return parts.join(' · ')
  }

  const hours = finiteNumber(day.hoursExact ?? day.hours)
  if (hours > 0) {
    const cong = roundDecimal(Math.min(hours * 60, standard) / standard, 4)
    return `Giờ nguồn ${roundDecimal(hours)}h ÷ ${standard / 60}h = ${roundDecimal(cong)} công${holidayLabel ? ` · ${holidayLabel}` : ''}`
  }

  if (workdays > 0) {
    return `Công nguồn = ${roundDecimal(workdays)}${holidayLabel ? ` · ${holidayLabel}` : ''}`
  }

  return holidayLabel || ''
}
