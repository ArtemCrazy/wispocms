import { DomainStatus, SiteType } from '../database/entities';
import { ContentService } from './content.service';

describe('ContentService public template package identity', () => {
  it('loads only package and version identity for the public payload', async () => {
    const site = {
      id: 'site-id',
      workspaceId: 'workspace-id',
      name: 'Wispo Media',
      slug: 'wispo-media',
      domain: null,
      domainStatus: DomainStatus.NOT_CONFIGURED,
      siteType: SiteType.MEDIA,
      isActive: true,
      linkedCommercialSite: null,
      templatePackageId: 'package-id',
      currentTemplatePackageVersionId: 'version-id',
    };
    const identityQuery = {
      leftJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({
        packageId: 'skinova-media',
        packageVersion: '1',
      }),
    };
    const sites = {
      findOne: jest.fn().mockResolvedValue(site),
      createQueryBuilder: jest.fn().mockReturnValue(identityQuery),
    };
    const articles = { find: jest.fn().mockResolvedValue([]) };
    const categories = { find: jest.fn().mockResolvedValue([]) };
    const pages = { find: jest.fn().mockResolvedValue([]) };
    const banners = { find: jest.fn().mockResolvedValue([]) };
    const service = new ContentService(
      sites as never,
      {} as never,
      categories as never,
      {} as never,
      articles as never,
      {} as never,
      {} as never,
      pages as never,
      banners as never,
    );

    const result = await service.getPublicSite('wispo-media');

    expect(sites.findOne).toHaveBeenCalledWith({
      where: { slug: 'wispo-media', isActive: true },
      relations: { linkedCommercialSite: true },
    });
    expect(identityQuery.select).toHaveBeenCalledWith(
      'templatePackage.packageId',
      'packageId',
    );
    expect(identityQuery.addSelect).toHaveBeenCalledWith(
      'currentVersion.packageVersion',
      'packageVersion',
    );
    expect(JSON.stringify(identityQuery.select.mock.calls)).not.toContain(
      'manifest',
    );
    expect(result.site.templatePackage).toEqual({
      packageId: 'skinova-media',
      packageVersion: '1',
    });
  });
});
