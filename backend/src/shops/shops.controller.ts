import { Controller, Get, Post, Put, Delete, Body, Param, Logger } from '@nestjs/common';
import { ShopsService } from './shops.service';
import { SettingsService } from '../settings/settings.service';

@Controller('api')
export class ShopsController {
  private readonly logger = new Logger(ShopsController.name);

  constructor(
    private readonly shopsService: ShopsService,
    private readonly settingsService: SettingsService,
  ) {}

  @Get('shop-groups')
  async getGroups() {
    const [groups, ungrouped] = await Promise.all([
      this.shopsService.getGroupsWithShops(),
      this.shopsService.getUngroupedShops(),
    ]);
    return { success: true, groups, ungrouped };
  }

  @Post('shop-groups')
  async createGroup(@Body() body: { name: string }) {
    try {
      const id = await this.shopsService.createGroup(body.name);
      return { success: true, id, message: `Đã tạo nhóm "${body.name}"` };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }

  @Put('shop-groups/:id')
  async renameGroup(@Param('id') id: string, @Body() body: { name: string }) {
    try {
      await this.shopsService.renameGroup(parseInt(id, 10), body.name);
      return { success: true, message: 'Đã đổi tên nhóm' };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }

  @Delete('shop-groups/:id')
  async deleteGroup(@Param('id') id: string) {
    try {
      await this.shopsService.deleteGroup(parseInt(id, 10));
      return { success: true, message: 'Đã xóa nhóm và các shop trong nhóm' };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }

  @Post('shop-groups/:id/apply')
  async applyGroup(@Param('id') id: string) {
    try {
      const groupId = parseInt(id, 10);
      const shopIds = await this.shopsService.getGroupShopIds(groupId);
      const shops = await this.shopsService.getShopsByIds(shopIds);

      if (shops.length === 0) {
        return { success: false, message: 'Nhóm này chưa có shop nào để áp dụng' };
      }

      const customerIds = shops.map((s) => s.svCustomerId).join(',');
      const labelsMap: Record<string, string> = {};
      shops.forEach((s) => {
        labelsMap[s.svCustomerId] = s.name || s.queryLabel || s.svCustomerId;
      });

      await this.settingsService.set('CUSTOMER_IDS', customerIds);
      await this.settingsService.set('CUSTOMER_LABELS_JSON', JSON.stringify(labelsMap));

      this.logger.log(`✅ Đã áp dụng nhóm shop #${groupId} (${shops.length} shop) làm bộ lọc CUSTOMER_IDS hiện tại.`);

      return {
        success: true,
        message: `Đã áp dụng ${shops.length} shop trong nhóm làm bộ lọc quét hiện tại!`,
        customerIds,
        customerLabelsJson: JSON.stringify(labelsMap),
      };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }

  @Post('shops')
  async createShop(@Body() body: any) {
    try {
      await this.shopsService.upsertShop(body);
      return { success: true, message: 'Đã thêm shop mới' };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }

  @Put('shops/:svCustomerId')
  async updateShop(@Param('svCustomerId') svCustomerId: string, @Body() body: any) {
    try {
      await this.shopsService.upsertShop({ ...body, svCustomerId });
      return { success: true, message: 'Đã cập nhật shop' };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }

  @Delete('shops/:svCustomerId')
  async deleteShop(@Param('svCustomerId') svCustomerId: string) {
    try {
      await this.shopsService.deleteShop(svCustomerId);
      return { success: true, message: 'Đã xóa shop' };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }
}
