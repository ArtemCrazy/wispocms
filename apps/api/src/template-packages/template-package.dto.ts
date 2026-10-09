import { IsObject, Validate, ValidatorConstraint } from 'class-validator';
import type { ValidatorConstraintInterface } from 'class-validator';
import { assertValidTemplatePackageRelease } from './template-package-release-validation';

@ValidatorConstraint({ name: 'templatePackageManifest', async: false })
export class TemplatePackageManifestConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    try {
      assertValidTemplatePackageRelease(value);
      return true;
    } catch {
      return false;
    }
  }

  defaultMessage(): string {
    return 'Некорректный manifest frontend-пакета';
  }
}

export class RegisterTemplatePackageDto {
  @IsObject()
  @Validate(TemplatePackageManifestConstraint)
  manifest!: unknown;
}
