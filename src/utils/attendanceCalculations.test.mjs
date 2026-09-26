import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calculateAttendanceMetrics,
  calculateAutomaticOvertime,
  calculateEffectiveCheckIn,
  calculateOverlapMinutes,
  calculateRegularMinutes,
  calculateSplitShiftWork,
  calculateWorkedMinutes,
  describeDayWorkFormula,
  getAttendanceHoliday
} from './attendanceCalculations.js'
import {
  DEFAULT_ATTENDANCE_SETTINGS,
  normalizeAttendanceShiftSettings,
  validateAttendanceSettings
} from './attendanceShift.js'

// ==================================================
// 19. CASE TEST A: 05:15 → 17:00
// ==================================================
test('Case Test A: 05:15 -> 17:00 (clamp về 07:00, loại nghỉ trưa, đủ 1 công, 0 OT)', () => {
  const result = calculateAttendanceMetrics({
    checkIn: '05:15',
    checkOut: '17:00'
  })
  assert.equal(result.effectiveCheckIn, '07:00')
  assert.equal(result.regularMinutes, 480)
  assert.equal(result.regularWorkdays, 1.0)
  assert.equal(result.overtimeHours, 0)
})

// ==================================================
// 20. CASE TEST B: 06:45 → 17:30
// ==================================================
test('Case Test B: 06:45 -> 17:30 (clamp về 07:00, đủ 8h công thường, OT 0.5h)', () => {
  const result = calculateAttendanceMetrics({
    checkIn: '06:45',
    checkOut: '17:30'
  })
  assert.equal(result.effectiveCheckIn, '07:00')
  assert.equal(result.regularMinutes, 480)
  assert.equal(result.regularWorkdays, 1.0)
  assert.equal(result.overtimeHours, 0.5)
})

// ==================================================
// 21. CASE TEST C: 07:00 → 11:00
// ==================================================
test('Case Test C: 07:00 -> 11:00 (chỉ làm ca sáng, 240p = 0.5 công, 0 OT)', () => {
  const result = calculateAttendanceMetrics({
    checkIn: '07:00',
    checkOut: '11:00'
  })
  assert.equal(result.effectiveCheckIn, '07:00')
  assert.equal(result.regularMinutes, 240)
  assert.equal(result.regularWorkdays, 0.5)
  assert.equal(result.overtimeHours, 0)
})

// ==================================================
// 22. CASE TEST D: 07:00 → 17:00
// ==================================================
test('Case Test D: 07:00 -> 17:00 (chuẩn 8h làm việc, nghỉ trưa không tính, công = 1.0, OT = 0)', () => {
  const result = calculateAttendanceMetrics({
    checkIn: '07:00',
    checkOut: '17:00'
  })
  assert.equal(result.effectiveCheckIn, '07:00')
  assert.equal(result.regularMinutes, 480)
  assert.equal(result.regularWorkdays, 1.0)
  assert.equal(result.overtimeHours, 0)
  // Tuyệt đối không ra 1 công + 2h OT
  assert.notEqual(result.overtimeHours, 2.0)
})

// ==================================================
// 23. CASE TEST E: 07:05 → 22:30
// ==================================================
test('Case Test E: 07:05 -> 22:30 (muộn 5p, công = 475/480, OT = 5.5h)', () => {
  const result = calculateAttendanceMetrics({
    checkIn: '07:05',
    checkOut: '22:30'
  })
  assert.equal(result.effectiveCheckIn, '07:05')
  assert.equal(result.regularMinutes, 475)
  const expectedWorkdays = 475 / 480
  assert.equal(result.regularWorkdays, expectedWorkdays)
  assert.equal(result.overtimeHours, 5.5)
})

// ==================================================
// 24. CASE TEST F: Nhiều lần chấm: 07:00, 11:00, 13:00, 17:00
// ==================================================
test('Case Test F: Nhiều lần chấm (firstPunch=07:00, lastPunch=17:00 -> 1 công, 0 OT)', () => {
  const punches = ['07:00', '11:00', '13:00', '17:00']
  const firstPunch = punches[0]
  const lastPunch = punches[punches.length - 1]
  const result = calculateAttendanceMetrics({
    checkIn: firstPunch,
    checkOut: lastPunch
  })
  assert.equal(result.effectiveCheckIn, '07:00')
  assert.equal(result.regularMinutes, 480)
  assert.equal(result.regularWorkdays, 1.0)
  assert.equal(result.overtimeHours, 0)
})

// ==================================================
// 25. CASE TEST G: 06:30 → 10:00
// ==================================================
test('Case Test G: 06:30 -> 10:00 (clamp về 07:00, 180p = 0.375 công, 0 OT)', () => {
  const result = calculateAttendanceMetrics({
    checkIn: '06:30',
    checkOut: '10:00'
  })
  assert.equal(result.effectiveCheckIn, '07:00')
  assert.equal(result.regularMinutes, 180)
  assert.equal(result.regularWorkdays, 180 / 480)
  assert.equal(result.regularWorkdays, 0.375)
  assert.equal(result.overtimeHours, 0)
})

// ==================================================
// 26. CASE TEST H: 10:00 → 14:00
// ==================================================
test('Case Test H: 10:00 -> 14:00 (vắt qua giờ nghỉ trưa: 60p sáng + 60p chiều = 120p, 0.25 công, 0 OT)', () => {
  const result = calculateAttendanceMetrics({
    checkIn: '10:00',
    checkOut: '14:00'
  })
  assert.equal(result.effectiveCheckIn, '10:00')
  assert.equal(result.regularMinutes, 120)
  assert.equal(result.regularWorkdays, 120 / 480)
  assert.equal(result.regularWorkdays, 0.25)
  assert.equal(result.overtimeHours, 0)
})

// ==================================================
// 27. CASE TEST I: 13:00 → 17:00
// ==================================================
test('Case Test I: 13:00 -> 17:00 (chỉ làm ca chiều, 240p = 0.5 công, 0 OT)', () => {
  const result = calculateAttendanceMetrics({
    checkIn: '13:00',
    checkOut: '17:00'
  })
  assert.equal(result.effectiveCheckIn, '13:00')
  assert.equal(result.regularMinutes, 240)
  assert.equal(result.regularWorkdays, 0.5)
  assert.equal(result.overtimeHours, 0)
})

// ==================================================
// 28. CASE TEST J: 13:30 → 18:00
// ==================================================
test('Case Test J: 13:30 -> 18:00 (ca chiều 210p = 0.4375 công, OT 17:00-18:00 = 1h)', () => {
  const result = calculateAttendanceMetrics({
    checkIn: '13:30',
    checkOut: '18:00'
  })
  assert.equal(result.effectiveCheckIn, '13:30')
  assert.equal(result.regularMinutes, 210)
  assert.equal(result.regularWorkdays, 210 / 480)
  assert.equal(result.regularWorkdays, 0.4375)
  assert.equal(result.overtimeHours, 1.0)
})

// ==================================================
// 29. TEST THAY ĐỔI SETTINGS (Custom Settings: 08:00-12:00, 13:00-17:00)
// ==================================================
test('Test thay đổi Settings: 08:00/12:00/13:00/17:00, input 07:30->17:30', () => {
  const customSettings = {
    workStart: '08:00',
    lunchStart: '12:00',
    lunchEnd: '13:00',
    workEnd: '17:00'
  }
  const result = calculateAttendanceMetrics({
    checkIn: '07:30',
    checkOut: '17:30',
    attendanceSettings: customSettings
  })
  // effectiveCheckIn phải clamp về 08:00
  assert.equal(result.effectiveCheckIn, '08:00')
  // Sáng 08:00-12:00 = 240p, Chiều 13:00-17:00 = 240p, Tổng = 480p
  assert.equal(result.regularMinutes, 480)
  assert.equal(result.standardWorkMinutes, 480)
  assert.equal(result.regularWorkdays, 1.0)
  // OT tính sau workEnd (17:00) -> 17:00-17:30 = 0.5h
  assert.equal(result.overtimeHours, 0.5)
})

// ==================================================
// 30. TEST SETTINGS KHÁC 8 TIẾNG (540 phút)
// ==================================================
test('Test Settings khác 8 tiếng: standardWorkMinutes = 540p, input 07:00->17:30', () => {
  const non480Settings = {
    workStart: '07:00',
    lunchStart: '12:00',
    lunchEnd: '13:30',
    workEnd: '17:30'
  }
  // Sáng 07:00-12:00 = 300p, Chiều 13:30-17:30 = 240p, Tổng standard = 540p
  const normalized = normalizeAttendanceShiftSettings(non480Settings)
  assert.equal(normalized.morningMinutes, 300)
  assert.equal(normalized.afternoonMinutes, 240)
  assert.equal(normalized.standardWorkMinutes, 540)

  const result = calculateAttendanceMetrics({
    checkIn: '07:00',
    checkOut: '17:30',
    attendanceSettings: non480Settings
  })
  assert.equal(result.regularMinutes, 540)
  assert.equal(result.standardWorkMinutes, 540)
  assert.equal(result.regularWorkdays, 1.0)
  assert.equal(result.overtimeHours, 0)
})

// ==================================================
// 31. TEST MULTI-COMPANY ISOLATION
// ==================================================
test('Test Multi-Company Isolation: Company A vs Company B có cấu hình riêng cho cùng input 07:30->17:30', () => {
  const companyASettings = {
    workStart: '07:00',
    lunchStart: '11:00',
    lunchEnd: '13:00',
    workEnd: '17:00'
  }
  const companyBSettings = {
    workStart: '08:00',
    lunchStart: '12:00',
    lunchEnd: '13:30',
    workEnd: '17:30'
  }

  const input = { checkIn: '07:30', checkOut: '17:30' }

  const resA = calculateAttendanceMetrics({
    ...input,
    attendanceSettings: companyASettings
  })
  const resB = calculateAttendanceMetrics({
    ...input,
    attendanceSettings: companyBSettings
  })

  // Company A:
  // effectiveCheckIn = 07:30
  // Sáng 07:30-11:00 = 210p, Chiều 13:00-17:00 = 240p -> regular = 450p
  // standard = 480p -> cong = 450/480 = 0.9375
  // OT sau 17:00 = 0.5h
  assert.equal(resA.effectiveCheckIn, '07:30')
  assert.equal(resA.regularMinutes, 450)
  assert.equal(resA.regularWorkdays, 450 / 480)
  assert.equal(resA.overtimeHours, 0.5)

  // Company B:
  // effectiveCheckIn = 08:00 (07:30 clamp về 08:00)
  // Sáng 08:00-12:00 = 240p, Chiều 13:30-17:30 = 240p -> regular = 480p
  // standard = 480p -> cong = 1.0
  // OT sau 17:30 = 0h
  assert.equal(resB.effectiveCheckIn, '08:00')
  assert.equal(resB.regularMinutes, 480)
  assert.equal(resB.regularWorkdays, 1.0)
  assert.equal(resB.overtimeHours, 0)

  // Đảm bảo 2 kết quả hoàn toàn độc lập
  assert.notEqual(resA.regularWorkdays, resB.regularWorkdays)
  assert.notEqual(resA.overtimeHours, resB.overtimeHours)
})

// ==================================================
// 32. VALIDATION SETTINGS
// ==================================================
test('Test Validation Settings: bắt buộc workStart < lunchStart < lunchEnd < workEnd', () => {
  // Hợp lệ
  assert.equal(validateAttendanceSettings({
    workStart: '07:00', lunchStart: '11:00', lunchEnd: '13:00', workEnd: '17:00'
  }).isValid, true)

  // Không hợp lệ: lunchEnd <= lunchStart
  assert.equal(validateAttendanceSettings({
    workStart: '07:00', lunchStart: '13:00', lunchEnd: '12:00', workEnd: '17:00'
  }).isValid, false)

  // Không hợp lệ: workStart >= lunchStart
  assert.equal(validateAttendanceSettings({
    workStart: '11:30', lunchStart: '11:00', lunchEnd: '13:00', workEnd: '17:00'
  }).isValid, false)

  // Không hợp lệ: lunchEnd >= workEnd
  assert.equal(validateAttendanceSettings({
    workStart: '07:00', lunchStart: '11:00', lunchEnd: '17:30', workEnd: '17:00'
  }).isValid, false)

  // Thiếu dữ liệu
  assert.equal(validateAttendanceSettings({}).isValid, false)
})

// ==================================================
// 33. MANUAL OVERTIME PRECEDENCE (tc1, tc2, tc3)
// ==================================================
test('Ưu tiên manual overtime (tc1, tc2, tc3) so với auto OT', () => {
  const manual = calculateAttendanceMetrics({
    log: { tc1: 2.5 },
    checkIn: '07:00',
    checkOut: '17:30' // auto OT chỉ là 0.5h
  })
  assert.equal(manual.overtimeHours, 2.5)
  assert.equal(manual.overtimeSource, 'manual')

  const excelDisabled = calculateAttendanceMetrics({
    log: { overtimeAutoDisabled: true },
    checkIn: '07:00',
    checkOut: '18:00'
  })
  assert.equal(excelDisabled.overtimeHours, 0)
  assert.equal(excelDisabled.overtimeSource, 'disabled')
})

// ==================================================
// 34. EDGE CASES: 1 punch, null checkIn/checkOut, invalid format
// ==================================================
test('Edge Cases: Ngày chỉ có 1 lần chấm (không tự suy luận checkOut, không cho 1 công)', () => {
  const singleIn = calculateAttendanceMetrics({
    checkIn: '07:00',
    checkOut: null
  })
  assert.equal(singleIn.hasPunchPair, false)
  assert.equal(singleIn.regularWorkdays, 0)
  assert.equal(singleIn.hours, 0)
  assert.equal(singleIn.overtimeHours, 0)
  assert.equal(singleIn.checkOut, null)

  const empty = calculateAttendanceMetrics({
    checkIn: '',
    checkOut: ''
  })
  assert.equal(empty.hasPunchPair, false)
  assert.equal(empty.regularWorkdays, 0)

  const reversed = calculateAttendanceMetrics({
    checkIn: '17:00',
    checkOut: '07:00'
  })
  assert.equal(reversed.hasPunchPair, false)
  assert.equal(reversed.regularWorkdays, 0)
})

// ==================================================
// 35. SPLIT SHIFT BACKWARD COMPATIBILITY
// ==================================================
test('Split shift backward compatibility: chia ca thành 2 buổi', () => {
  const splitShift = {
    enabled: true,
    morning: { start: '08:30', end: '12:00', workdays: 0.5 },
    afternoon: { start: '13:00', end: '17:30', workdays: 0.5 }
  }
  const full = calculateAttendanceMetrics({
    checkIn: '08:24',
    checkOut: '17:37',
    splitShift
  })
  assert.equal(full.workedMinutes, 480)
  assert.equal(full.hours, 8)
  assert.equal(full.regularWorkdays, 1)

  const outside = calculateAttendanceMetrics({
    checkIn: '18:00',
    checkOut: '19:00',
    splitShift
  })
  assert.equal(outside.workedMinutes, 0)
  assert.equal(outside.regularWorkdays, 0)
})

// ==================================================
// 36. TOOLTIP FORMULA DESCRIPTION
// ==================================================
test('Mô tả công thức chấm công đúng theo logic mới', () => {
  const formula = describeDayWorkFormula({
    checkIn: '06:45',
    checkOut: '17:30',
    effectiveCheckIn: '07:00',
    regularMinutes: 480,
    workdays: 1.0,
    overtimeHours: 0.5
  })
  assert.match(formula, /06:45 \(quy về 07:00\)→17:30/)
  assert.match(formula, /Công chuẩn: 480p ÷ 480p = 1 công/)
  assert.match(formula, /Tăng ca: 0.5h/)
})

// ==================================================
// 37. YÊU CẦU TEST CHẤM CÔNG VÀ TĂNG CA MỚI
// ==================================================
test('Yêu cầu mới: 07:00 → 17:00 = 1 công, 0 OT', () => {
  const splitShift = {
    enabled: true,
    morning: { start: '07:00', end: '11:00', workdays: 0.5 },
    afternoon: { start: '13:00', end: '17:00', workdays: 0.5 }
  }
  const result = calculateAttendanceMetrics({
    checkIn: '07:00',
    checkOut: '17:00',
    splitShift
  })
  assert.equal(result.regularWorkdays, 1.0)
  assert.equal(result.overtimeHours, 0)
  assert.equal(result.overtimeMinutes, 0)
})

test('Yêu cầu mới: 06:45 → 17:30 = 1 công, 0.5h OT', () => {
  const splitShift = {
    enabled: true,
    morning: { start: '07:00', end: '11:00', workdays: 0.5 },
    afternoon: { start: '13:00', end: '17:00', workdays: 0.5 }
  }
  const result = calculateAttendanceMetrics({
    checkIn: '06:45',
    checkOut: '17:30',
    splitShift
  })
  assert.equal(result.regularWorkdays, 1.0)
  assert.equal(result.overtimeHours, 0.5)
  assert.equal(result.overtimeMinutes, 30)
})

test('Yêu cầu mới: 07:05 → 23:34 = OT 6h34 (394 phút)', () => {
  const splitShift = {
    enabled: true,
    morning: { start: '07:00', end: '11:00', workdays: 0.5 },
    afternoon: { start: '13:00', end: '17:00', workdays: 0.5 }
  }
  const result = calculateAttendanceMetrics({
    checkIn: '07:05',
    checkOut: '23:34',
    splitShift
  })
  assert.equal(result.overtimeMinutes, 394)
  const otH = Math.floor(result.overtimeMinutes / 60)
  const otM = Math.round(result.overtimeMinutes % 60)
  assert.equal(`${otH}h${otM < 10 ? '0' : ''}${otM}`, '6h34')
})

test('Yêu cầu mới: splitShift vẫn loại 11:00–13:00 khỏi công chuẩn', () => {
  const splitShift = {
    enabled: true,
    morning: { start: '07:00', end: '11:00', workdays: 0.5 },
    afternoon: { start: '13:00', end: '17:00', workdays: 0.5 }
  }
  const result = calculateAttendanceMetrics({
    checkIn: '07:00',
    checkOut: '17:00',
    splitShift
  })
  assert.equal(result.workedMinutes, 480)
  assert.equal(result.regularMinutes, 480)
  assert.equal(result.hours, 8)
  assert.equal(result.regularWorkdays, 1.0)
})

test('Yêu cầu mới: manual OT vẫn ưu tiên hơn auto OT', () => {
  const splitShift = {
    enabled: true,
    morning: { start: '07:00', end: '11:00', workdays: 0.5 },
    afternoon: { start: '13:00', end: '17:00', workdays: 0.5 }
  }
  const result = calculateAttendanceMetrics({
    log: { tc1: 2.0 },
    checkIn: '07:00',
    checkOut: '23:34',
    splitShift
  })
  assert.equal(result.overtimeHours, 2.0)
  assert.equal(result.overtimeSource, 'manual')
})
