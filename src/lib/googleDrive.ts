import { gapi } from 'gapi-script';

const CLIENT_ID = 'ВАШ_CLIENT_ID.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/drive.file';
const DISCOVERY_DOCS = ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'];

export const initGoogleApi = async (): Promise<void> => {
  return new Promise((resolve, reject) => {
    gapi.load('client:auth2', async () => {
      try {
        await gapi.client.init({
          clientId: CLIENT_ID,
          scope: SCOPES,
          discoveryDocs: DISCOVERY_DOCS,
        });
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
};

export const uploadFileToDrive = async (file: File, folderId: string): Promise<string> => {
  const authInstance = gapi.auth2.getAuthInstance();
  if (!authInstance.isSignedIn.get()) {
    await authInstance.signIn();
  }
  const accessToken = authInstance.currentUser.get().getAuthResponse().access_token;

  const metadata = {
    name: file.name,
    mimeType: file.type,
    parents: [folderId], // ID папки на Google Диске
  };

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', file);

  // Загрузка через multipart
  const response = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
    {
      method: 'POST',
      headers: new Headers({ Authorization: `Bearer ${accessToken}` }),
      body: form,
    }
  );

  if (!response.ok) {
    throw new Error(`Upload failed: ${response.statusText}`);
  }

  const result = await response.json();
  const fileId = result.id;

  // Возвращаем прямую ссылку для отображения (img src)
  return `https://drive.google.com/uc?export=view&id=${fileId}`;
};
