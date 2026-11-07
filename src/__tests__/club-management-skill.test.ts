import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ClubError } from '@/features/club/model/validation'
import { ORG, rpc } from '@/features/club/server/gateway'
import { saveManagementSkill } from '@/features/club/server/management-skill'

vi.mock('@/features/club/server/gateway', () => ({
  ORG: '00000000-0000-0000-0000-000000000001',
  rpc: vi.fn(),
}))

const staff = '11111111-1111-4111-8111-111111111111'
const player = '22222222-2222-4222-8222-222222222222'
const reference = '33333333-3333-4333-8333-333333333333'
const change = { user_id: player, level: 'advanced', expected_version: '4532' }

beforeEach(() => vi.resetAllMocks())

describe('management skill editing', () => {
  it.each(['developer', 'admin'] as const)('allows %s and sends only the tenant-scoped skill change to SQL', async role => {
    const saved = { user_id: player, level: 'advanced', version: '4533' }
    vi.mocked(rpc).mockResolvedValue(saved)
    expect(await saveManagementSkill({ ...change, role: 'developer', birth_date: '2000-01-01' }, role, staff, reference)).toEqual(saved)
    expect(rpc).toHaveBeenCalledExactlyOnceWith('dvc_management_skill_save', {
      p_org: ORG, p_actor: staff, p_target: player, p_level: 'advanced', p_version: '4532', p_ref: reference,
    })
  })

  it.each(['coordinator', 'facilitator', 'player'] as const)('denies %s before invoking SQL', role => {
    expect(() => saveManagementSkill(change, role, staff, reference)).toThrow('Access denied')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('denies a missing actor even when the caller supplies a staff role', () => {
    expect(() => saveManagementSkill(change, 'admin', null, reference)).toThrow('Access denied')
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each([{ level: 'toString' }, { level: null }, { user_id: 'pending@example.test' }, { expected_version: 4532 }, { expected_version: '' }])(
    'rejects invalid or absent skill write fields %j', invalid => {
      expect(() => saveManagementSkill({ ...change, ...invalid }, 'admin', staff, reference)).toThrow(ClubError)
      expect(rpc).not.toHaveBeenCalled()
    },
  )

  it('preserves the stale profile conflict for the editor recovery path', async () => {
    const conflict = new ClubError('Player profile changed. Refresh Users and try again', 409, 'CONFLICT')
    vi.mocked(rpc).mockRejectedValueOnce(conflict)
    await expect(saveManagementSkill(change, 'admin', staff, reference)).rejects.toBe(conflict)
  })
})
