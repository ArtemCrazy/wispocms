import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PreparationDraftDto, PreparationDto } from './content-center.dto';

describe('preparation request title validation', () => {
  it('trims names and preserves compatibility with unnamed requests', async () => {
    const dto = plainToInstance(PreparationDto, {
      instruction: 'Task',
      withoutMaterials: true,
      promptTitle: '  Анализ компании  ',
    });
    expect(await validate(dto)).toEqual([]);
    expect(dto.promptTitle).toBe('Анализ компании');
    expect(
      await validate(
        plainToInstance(PreparationDto, {
          instruction: 'Task',
          withoutMaterials: true,
        }),
      ),
    ).toEqual([]);
  });

  it('rejects oversized and non-text titles for runs and drafts', async () => {
    for (const Type of [PreparationDto, PreparationDraftDto]) {
      for (const promptTitle of ['x'.repeat(161), { title: 'Invalid' }]) {
        const dto = plainToInstance(Type, {
          instruction: 'Task',
          withoutMaterials: true,
          revision: 0,
          promptTitle,
        });
        expect(
          (await validate(dto)).some(
            (error) => error.property === 'promptTitle',
          ),
        ).toBe(true);
      }
    }
  });
});
