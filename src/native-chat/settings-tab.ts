// BYOK settings for native reading chat (Slice 2c). The API key is chosen or created
// with Obsidian's SecretComponent; only the secret's name is saved in plugin data.

import { strings } from './messages';
import { parseStoredSettings } from './settings';
import { getPreset, DEFAULT_PRESET_ID } from '../provider/presets';

export function createSettingsTabClass(obsidian: any, plugin: any) {
  const { PluginSettingTab, Setting, SecretComponent } = obsidian;

  return class ReadingChatSettingTab extends PluginSettingTab {
    showAdvanced = false;
    statusEl: any = null;

    display() {
      const { containerEl } = this;
      containerEl.empty();
      const text = strings(plugin.getLocale()).settings;
      const stored: any = parseStoredSettings(plugin.nativeSettings).nativeChat;
      const preset = getPreset(DEFAULT_PRESET_ID);

      new Setting(containerEl).setName(text.providerName).setDesc(text.providerDesc);

      const keySetting = new Setting(containerEl).setName(text.apiKeyName).setDesc(text.apiKeyDesc);
      if (typeof SecretComponent === 'function' && typeof keySetting.addComponent === 'function') {
        keySetting.addComponent((el: HTMLElement) =>
          new SecretComponent(this.app, el)
            .setValue(stored.apiKeySecretName ?? '')
            .onChange((name: string) => this.change('apiKeySecretName', name)),
        );
      } else {
        keySetting.setDesc(text.apiKeyUnavailable);
      }

      new Setting(containerEl)
        .setName(text.modelName)
        .setDesc(text.modelDesc)
        .addText((input: any) =>
          input
            .setPlaceholder(preset.defaultModel)
            .setValue(stored.model ?? '')
            .onChange((value: string) => this.change('model', value)),
        );

      new Setting(containerEl).setName(text.showAdvanced).addToggle((toggle: any) =>
        toggle.setValue(this.showAdvanced).onChange((value: boolean) => {
          this.showAdvanced = value;
          this.display();
        }),
      );

      if (this.showAdvanced) {
        new Setting(containerEl)
          .setName(text.baseUrlName)
          .setDesc(text.baseUrlDesc)
          .addText((input: any) =>
            input
              .setPlaceholder(preset.baseUrl)
              .setValue(stored.baseUrl ?? '')
              .onChange((value: string) => this.change('baseUrl', value)),
          );
        new Setting(containerEl)
          .setName(text.timeoutName)
          .setDesc(text.timeoutDesc)
          .addText((input: any) =>
            input
              .setPlaceholder('60')
              .setValue(stored.timeoutMs ? String(stored.timeoutMs / 1000) : '')
              .onChange((value: string) => this.change('timeoutSeconds', value)),
          );
      }

      this.statusEl = containerEl.createDiv({ cls: 'arc-settings-status' });

      new Setting(containerEl).setName(text.privacyHeading).setHeading();
      const privacy = containerEl.createDiv({ cls: 'arc-settings-privacy' });
      privacy.createEl('p', { text: text.privacySends });
      privacy.createEl('p', { text: text.privacyNotSent });
      privacy.createEl('p', { text: text.privacyCost });
    }

    async change(key: string, value: string) {
      const text = strings(plugin.getLocale()).settings;
      const result = await plugin.updateNativeChatSetting(key, value);
      if (this.statusEl) this.statusEl.setText(result.error ? `${text.invalidValue}${result.error.message}` : '');
    }
  };
}
