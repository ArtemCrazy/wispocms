import { BadRequestException } from '@nestjs/common';
import { PlatformRole } from '../database/entities';
import { PrivacyController } from './privacy.controller';

describe('PrivacyController revision checkpoint', () => {
  const request = {
    auth: { userId: 'user-id', platformRole: PlatformRole.WISPO_ADMIN },
  };

  function setup() {
    const privacy = {
      updateSettings: jest.fn().mockResolvedValue({ document: 'Draft policy' }),
    };
    const revisions = {
      prepareMutation: jest.fn().mockResolvedValue('baseline-id'),
      save: jest.fn().mockResolvedValue({
        document: 'Draft policy',
        draftRevisionId: 'next-id',
      }),
    };
    return {
      privacy,
      revisions,
      controller: new PrivacyController(privacy as never, revisions as never),
    };
  }

  it('rejects a mutation without an explicit expected draft id', async () => {
    const { controller, privacy } = setup();
    await expect(
      controller.updateSettings(
        'site-id',
        request as never,
        { searchable: true } as never,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(privacy.updateSettings).not.toHaveBeenCalled();
  });

  it('creates the baseline before mutation and checkpoints the result server-side', async () => {
    const { controller, privacy, revisions } = setup();

    await expect(
      controller.updateSettings('site-id', request as never, {
        expectedDraftRevisionId: null,
      }),
    ).resolves.toMatchObject({ draftRevisionId: 'next-id' });

    expect(revisions.prepareMutation).toHaveBeenCalledWith(
      'site-id',
      'site_privacy',
      request.auth,
      null,
    );
    expect(privacy.updateSettings).toHaveBeenCalled();
    expect(revisions.save).toHaveBeenCalledWith(
      'site-id',
      'site_privacy',
      request.auth,
      {
        snapshot: { document: 'Draft policy' },
        expectedDraftRevisionId: 'baseline-id',
      },
    );
  });
});
