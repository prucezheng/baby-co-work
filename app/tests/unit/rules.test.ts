import { describe, expect, it } from 'vitest';
import { timeSlotFromIso, validateAssignment } from '../../src/domain/rules';
import type { FamilyMember } from '../../src/domain/types';

const members: FamilyMember[] = [
  {
    member_id: 'dad-1',
    display_name: '爸爸',
    role: '爸爸',
    pin_hash: 'hash',
    identity_claimed: true,
    experience: 'basic',
    available_slots: ['evening', 'night'],
    limitations: [],
    preference: 'assist',
    temporary_unavailable: false
  },
  {
    member_id: 'grandma-1',
    display_name: '奶奶',
    role: '奶奶',
    pin_hash: 'hash',
    identity_claimed: true,
    experience: 'experienced',
    available_slots: ['morning', 'daytime'],
    limitations: ['不可夜间照护', '不可弯腰'],
    preference: 'simple',
    temporary_unavailable: false
  }
];

describe('validateAssignment', () => {
  it('allows null assignee as 待认领', () => {
    expect(validateAssignment(null, null, members)).toBeNull();
  });

  it('rejects members not in the family', () => {
    const violation = validateAssignment('ghost-member', null, members);
    expect(violation?.code).toBe('UNKNOWN_MEMBER');
  });

  it('rejects temporarily unavailable members', () => {
    const unavailable = members.map((m) =>
      m.member_id === 'dad-1' ? { ...m, temporary_unavailable: true } : m
    );
    const violation = validateAssignment('dad-1', null, unavailable);
    expect(violation?.code).toBe('MEMBER_UNAVAILABLE');
  });

  it('rejects night tasks for members with night limitations', () => {
    const violation = validateAssignment('grandma-1', '2026-07-21T23:30:00+08:00', members);
    expect(violation?.code).toBe('LIMITATION_CONFLICT');
  });

  it('allows night tasks for members without night limitations', () => {
    expect(validateAssignment('dad-1', '2026-07-21T23:30:00+08:00', members)).toBeNull();
  });

  it('ignores night limitations for daytime tasks', () => {
    expect(validateAssignment('grandma-1', '2026-07-21T14:00:00+08:00', members)).toBeNull();
  });
});

describe('timeSlotFromIso', () => {
  it('maps hours to slots', () => {
    expect(timeSlotFromIso('2026-07-21T08:00:00+08:00')).toBeDefined();
  });
});
