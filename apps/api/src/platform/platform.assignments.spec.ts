import { PlatformRole, WorkspaceRole } from '../database/entities';
import { PlatformService } from './platform.service';

describe('PlatformService multi-workspace assignments', () => {
  it('replaces employee assignments atomically with multiple workspaces', async () => {
    const users = {
      findOneBy: jest.fn().mockResolvedValue({
        id: 'employee-id',
        platformRole: PlatformRole.EMPLOYEE,
      }),
    };
    const workspaces = { existsBy: jest.fn().mockResolvedValue(true) };
    const manager = {
      delete: jest.fn().mockResolvedValue({}),
      create: jest.fn((_entity: unknown, row: Record<string, unknown>) => row),
      save: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
    };
    const memberships = {
      manager: {
        transaction: jest.fn(
          (callback: (transactionManager: typeof manager) => Promise<void>) =>
            callback(manager),
        ),
      },
    };
    const service = new PlatformService(
      users as never,
      workspaces as never,
      {} as never,
      {} as never,
      memberships as never,
    );

    await expect(
      service.updateUserWorkspaces('employee-id', [
        '77bbc150-03f9-4ae4-9713-a7c8de79897d',
        'c9772fe5-9a26-4280-aefe-ac9d888d033d',
      ]),
    ).resolves.toEqual({
      userId: 'employee-id',
      workspaceIds: [
        '77bbc150-03f9-4ae4-9713-a7c8de79897d',
        'c9772fe5-9a26-4280-aefe-ac9d888d033d',
      ],
    });
    expect(manager.delete).toHaveBeenCalled();
    expect(manager.save).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([
        expect.objectContaining({ role: WorkspaceRole.EMPLOYEE }),
        expect.objectContaining({ role: WorkspaceRole.EMPLOYEE }),
      ]),
    );
  });
});
