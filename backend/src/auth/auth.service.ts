import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SettingsService } from '../settings/settings.service';
import axios from 'axios';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private cachedToken: string | null = null;
  private checkApiUrl = 'https://api.svexpress.vn/v1/announcement/me';

  constructor(
    private readonly configService: ConfigService,
    private readonly settingsService: SettingsService,
  ) {}

  async isTokenValid(tokenStr: string): Promise<boolean> {
    if (!tokenStr) return false;
    const formatted = tokenStr.startsWith('Bearer ') ? tokenStr : `Bearer ${tokenStr}`;

    try {
      const response = await axios.get(this.checkApiUrl, {
        headers: { Authorization: formatted, Accept: 'application/json' },
        timeout: 5000
      });
      return response.status === 200;
    } catch (err) {
      if (err.response?.status === 401 || err.response?.status === 403) {
        return false;
      }
      return true;
    }
  }

  async login(): Promise<string | null> {
    const username = this.settingsService.get('SV_USERNAME') || this.configService.get<string>('svUsername');
    const password = this.settingsService.get('SV_PASSWORD') || this.configService.get<string>('svPassword');
    const loginUrl = this.settingsService.get('SV_LOGIN_API_URL') || this.configService.get<string>('svLoginApiUrl');

    if (!username || !password) {
      return null;
    }

    try {
      this.logger.log('🔑 Đang tiến hành đăng nhập SV Express để cấp JWT Token mới...');
      
      const payload = {
        email: username,
        password: password,
        rememberMe: true,
        type_source: true
      };

      const response = await axios.post(loginUrl, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000
      });

      const token = response.data?.accessToken || response.data?.token || response.data?.data?.accessToken;
      
      if (token) {
        this.cachedToken = token;
        this.logger.log('✅ Đăng nhập thành công! Token mới đã được cấp và kiểm tra hợp lệ.');
        return `Bearer ${token}`;
      }
    } catch (err) {
      this.logger.error(`❌ Lỗi khi tự động đăng nhập SV Express: ${err.response?.data?.error?.message || err.message}`);
    }

    return null;
  }

  async getToken(forceRefresh = false): Promise<string | null> {
    const envToken = this.settingsService.get('SV_AUTH_TOKEN') || this.configService.get<string>('svAuthToken');
    if (envToken && envToken.trim() !== '' && envToken !== 'DÁN_TOKEN_CỦA_BẠN_VÀO_ĐÂY' && !forceRefresh) {
      const formatted = envToken.startsWith('Bearer ') ? envToken : `Bearer ${envToken}`;
      if (await this.isTokenValid(formatted)) {
        return formatted;
      }
      this.logger.warn('⚠️ Token trong .env đã hết hạn. Chuyển sang tự động đăng nhập...');
    }

    if (this.cachedToken && !forceRefresh) {
      const formatted = `Bearer ${this.cachedToken}`;
      if (await this.isTokenValid(formatted)) {
        return formatted;
      }
      this.logger.warn('⚠️ Token lưu tạm đã hết hạn. Đang thực hiện đăng nhập lại...');
      this.cachedToken = null;
    }

    return await this.login();
  }
}
