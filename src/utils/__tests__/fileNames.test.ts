import {
  buildAnchorFileName,
  buildAttachmentFileName,
  buildZipPath,
  getMimeType,
} from '../fileNames';

describe('fileNames', () => {
  it('builds attachment and anchor filenames', () => {
    expect(buildAttachmentFileName('photo', 1_710_000_000_000, 'ab12')).toBe(
      'photo_1710000000000_ab12.jpg',
    );
    expect(buildAnchorFileName('photo', 1_710_000_000_000, 'ab12')).toBe(
      'photo_1710000000000_ab12.json',
    );
  });

  it('builds zip paths under attachments/', () => {
    expect(buildZipPath('photo_1710000000000_ab12.jpg')).toBe(
      'attachments/photo_1710000000000_ab12.jpg',
    );
  });

  it('returns expected mime types', () => {
    expect(getMimeType('audio')).toBe('audio/mp4');
    expect(getMimeType('text')).toBe('text/plain');
  });
});
