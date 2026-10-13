import { readFileSync } from 'node:fs'
import { Script, createContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const code = readFileSync('scripts/google-apps-script/registration.gs', 'utf8')

function setup(statuses = [200]) {
  const steps: string[] = []
  const headers = ['Email', 'First Name', 'Last Name', 'Position', 'Game Schedule', 'Registration Type']
  const row = ['team@example.com', 'Ana', 'Santos', 'Setter',
    '10-13-26 - Court (Tue, 6:30PM-9:30PM)', 'Team Registration (6)']
  const responseSheet = {
    getLastColumn: () => headers.length,
    getRange: (rowIndex: number) => ({ getValues: () => [rowIndex === 1 ? headers : row] }),
  }
  const fetch = vi.fn(() => {
    steps.push('notify')
    return { getResponseCode: () => statuses.shift() ?? 200 }
  })
  const context = createContext({
    SpreadsheetApp: {
      openByUrl: () => ({
        getSheetByName: () => responseSheet,
        getId: () => 'published-week-123',
      }),
      flush: () => steps.push('flush'),
    },
    FormApp: { getActiveForm: () => ({}) },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (key: string) => key === 'DVC_APP_URL' ? 'https://example.test/' : 'test-secret',
    }) },
    UrlFetchApp: { fetch },
    Utilities: { sleep: vi.fn() },
    Logger: { log: vi.fn() },
  })
  new Script(code).runInContext(context)
  context.addTeamMembersToGameSheet = () => steps.push('team rows')
  context.sendCalendarInvite = () => steps.push('invite')
  return { context, fetch, steps }
}

describe('Apps Script notification integration', () => {
  it('writes and flushes team rows before notifying the app', () => {
    const { context, steps } = setup()
    context.onFormSubmit({ range: { getRow: () => 2 } })
    expect(steps).toEqual(['team rows', 'flush', 'notify', 'invite'])
  })

  it('sends only game identity and authenticates in a header', () => {
    const { context, fetch } = setup()
    context.notifyDvcApp('10-13-26 - Court (Tue, 6:30PM-9:30PM)')
    const [url, options] = fetch.mock.calls[0] as unknown as [string, {
      headers: Record<string, string>; payload: string
    }]
    expect(url).toBe('https://example.test/api/registrations/updated')
    expect(options.headers['x-registration-key']).toBe('test-secret')
    expect(JSON.parse(options.payload)).toEqual({
      spreadsheetId: 'published-week-123',
      scheduleOption: '10-13-26 - Court (Tue, 6:30PM-9:30PM)',
    })
  })

  it('retries temporary failures and accepts a later success', () => {
    const { context, fetch } = setup([503, 429, 200])
    context.notifyDvcApp('10-13-26 - Court (Tue, 6:30PM-9:30PM)')
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('does not retry an incorrect secret or prevent the calendar invite', () => {
    const { context, fetch, steps } = setup([401])
    context.onFormSubmit({ range: { getRow: () => 2 } })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(steps.at(-1)).toBe('invite')
  })
})
