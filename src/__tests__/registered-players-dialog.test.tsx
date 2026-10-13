import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { RegisteredPlayersDialog } from '@/components/registered-players-dialog'

const baseProps = {
  open: true,
  titleId: 'roster-title',
  date: 'April 14, 2026',
  location: 'San Carlos Seminary',
  time: '6:30PM-9:30PM',
  onClose: () => {},
  onRetry: () => {},
}

describe('RegisteredPlayersDialog', () => {
  it('shows the game date in the modal header', () => {
    const html = renderToStaticMarkup(<RegisteredPlayersDialog
      {...baseProps}
      loading={false}
      error={false}
      data={null}
    />)

    expect(html).toContain('April 14, 2026 · San Carlos Seminary · 6:30PM-9:30PM')
  })

  it('shows grouped first names and no surnames', () => {
    const html = renderToStaticMarkup(<RegisteredPlayersDialog
      {...baseProps}
      loading={false}
      error={false}
      data={{
        fetchedAt: '2026-10-13T12:00:00.000Z',
        groups: [
          { position: 'Open Spiker', players: [
            { firstName: 'Ana', count: 1 },
            { firstName: 'Ben', count: 1 },
          ] },
          { position: 'Setter', players: [{ firstName: 'Cara', count: 1 }] },
        ],
      }}
    />)

    expect(html).toContain('Ana')
    expect(html).toContain('Ben')
    expect(html).toContain('Open Spiker')
    expect(html).not.toContain('Santos')
  })

  it('shows a merged team label while preserving the registration total', () => {
    const html = renderToStaticMarkup(<RegisteredPlayersDialog
      {...baseProps}
      loading={false}
      error={false}
      data={{
        fetchedAt: '2026-10-13T12:00:00.000Z',
        groups: [{ position: 'Setter', players: [
          { firstName: 'Ana', count: 2 },
          { firstName: 'Ben', count: 1 },
        ] }],
      }}
    />)

    expect(html).toContain('Ana&#x27;s Team (2)')
    expect(html).toContain('>3</span>')
  })

  it('shows a retry action when loading fails', () => {
    const html = renderToStaticMarkup(<RegisteredPlayersDialog
      {...baseProps} loading={false} error data={null}
    />)
    expect(html).toContain('Try again')
  })

  it('shows an empty state for a game with no registrations', () => {
    const html = renderToStaticMarkup(<RegisteredPlayersDialog
      {...baseProps}
      loading={false}
      error={false}
      data={{ fetchedAt: '2026-10-13T12:00:00.000Z', groups: [] }}
    />)
    expect(html).toContain('No registered players yet')
  })
})
