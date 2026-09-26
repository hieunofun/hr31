import assert from 'node:assert/strict'
import test from 'node:test'
import { findDeocaPunchHeader, getDeocaShiftName, parseDeocaPunchSheet } from './deocaPunchImport.js'

const headers = [
  'Tên riêng', 'Họ', 'ID', 'Bộ phận', 'Ngày',
  'Ngày trong tuần', 'Số lần quẹt thẻ', 'Ghi'
]

test('finds the DEOCA format by all eight headers after description rows', () => {
  const rows = [[], ['Phiếu chấm công'], [], [], [], [], [], headers]
  assert.deepEqual(findDeocaPunchHeader(rows), {
    rowIndex: 7,
    columns: {
      first_name: 0,
      last_name: 1,
      employee_code: 2,
      department_location: 3,
      attendance_date: 4,
      weekday: 5,
      punch_count: 6,
      raw_punch_times: 7
    }
  })
  assert.equal(findDeocaPunchHeader([['Mã NV', 'Tên NV', 'Ngày', 'Lần 1']]), null)
})

test('maps columns by header even when the order changes', () => {
  const rows = [
    ['Ghi', 'Ngày', 'ID', 'Họ', 'Bộ phận', 'Tên riêng', 'Số lần quẹt thẻ', 'Ngày trong tuần'],
    ['07:17;17:07', '01/07/2026', 'DC01', 'VAN B', 'Hầm 3', 'NGUYEN', '2', 'Thứ Tư']
  ]
  const { records } = parseDeocaPunchSheet(rows)
  assert.deepEqual(records[0], {
    first_name: 'NGUYEN',
    last_name: 'VAN B',
    employee_code: 'DC01',
    department_location: 'Hầm 3',
    attendance_date: '2026-07-01',
    weekday: 'Thứ Tư',
    punch_count: 2,
    raw_punch_times: '07:17;17:07',
    check_in: '07:17',
    check_out: '17:07',
    punches: ['07:17', '17:07'],
    source_row: 2
  })
})

test('uses earliest and latest valid distinct punches, preserving the raw cell', () => {
  const samples = [
    ['07:17;17:07', '07:17', '17:07'],
    ['06:52;06:52;17:16;17:16', '06:52', '17:16'],
    ['07:05;07:20;17:12;21:10;23:34', '07:05', '23:34'],
    ['08:23', '08:23', null],
    ['08:23;08:23;invalid;25:00', '08:23', null],
    ['17:07;07:17', '07:17', '17:07']
  ]
  for (const [raw, checkIn, checkOut] of samples) {
    const { records } = parseDeocaPunchSheet([
      headers,
      ['NGUYEN', 'VAN B', 'DC01', 'Hầm 3', '01/07/2026', 'Thứ Tư', '2', raw]
    ])
    assert.equal(records[0].raw_punch_times, raw)
    assert.equal(records[0].check_in, checkIn)
    assert.equal(records[0].check_out, checkOut)
  }
})

test('finds the shift only at the end of the DEOCA department path', () => {
  assert.equal(getDeocaShiftName('Hầm 3 > Ca 1'), 'Ca 1')
  assert.equal(getDeocaShiftName('Hầm 3/Ca 2'), 'Ca 2')
  assert.equal(getDeocaShiftName('Hầm 3'), '')
})
