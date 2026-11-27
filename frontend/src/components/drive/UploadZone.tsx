"use client";

import { InboxOutlined } from "@ant-design/icons";
import { App, Upload } from "antd";

import { MAX_FILE_BYTES } from "@/lib/crypto";
import { apiErrorMessage, hasFieldError } from "@/lib/api";
import { uploadFile } from "@/lib/storage";

interface UploadZoneProps {
  folderId: string | null;
  onUploaded: () => void;
}

export default function UploadZone({ folderId, onUploaded }: UploadZoneProps) {
  const { message } = App.useApp();

  return (
    <Upload.Dragger
      multiple
      beforeUpload={(file) => {
        if (file.size > MAX_FILE_BYTES) {
          message.error(`«${file.name}» больше 200 МБ`);
          return Upload.LIST_IGNORE;
        }
        return true;
      }}
      customRequest={async ({ file, onProgress, onSuccess, onError }) => {
        try {
          await uploadFile(file as File, folderId, (percent) => onProgress?.({ percent }));
          onSuccess?.(null);
          onUploaded();
        } catch (err) {
          const reason = hasFieldError(err, "blob", "Storage quota exceeded.")
            ? "недостаточно места в хранилище"
            : apiErrorMessage(err);
          message.error(`Не удалось загрузить «${(file as File).name}»: ${reason}`);
          onError?.(err as Error);
        }
      }}
    >
      <p className="ant-upload-drag-icon">
        <InboxOutlined />
      </p>
      <p className="ant-upload-text">Нажмите или перетащите файлы для загрузки</p>
      <p className="ant-upload-hint">
        Максимальный размер 200 МБ.
      </p>
    </Upload.Dragger>
  );
}
