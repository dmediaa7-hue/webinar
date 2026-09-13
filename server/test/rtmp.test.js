// Unit tests for the RTMP relay helpers (URL resolution + validation + the
// FFmpeg argument builder). The live socket/FFmpeg pipeline is exercised
// manually against a real ingest endpoint.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveRtmpUrl, isValidRtmpUrl, buildFfmpegArgs } = require('../src/rtmp');

test('resolveRtmpUrl appends the key with a single slash separator', () => {
  assert.equal(resolveRtmpUrl('rtmp://a.rtmp.youtube.com/live2', 'abcd-1234'),
    'rtmp://a.rtmp.youtube.com/live2/abcd-1234');
  assert.equal(resolveRtmpUrl('rtmp://a.rtmp.youtube.com/live2/', 'abcd-1234'),
    'rtmp://a.rtmp.youtube.com/live2/abcd-1234');
});

test('resolveRtmpUrl returns the bare URL when no key is supplied', () => {
  assert.equal(resolveRtmpUrl('rtmp://ingest.example.com/app', ''), 'rtmp://ingest.example.com/app');
  assert.equal(resolveRtmpUrl('rtmp://ingest.example.com/app', null), 'rtmp://ingest.example.com/app');
});

test('resolveRtmpUrl tolerates whitespace around both fields', () => {
  assert.equal(resolveRtmpUrl('  rtmp://ingest.example.com/app  ', '  key-1  '),
    'rtmp://ingest.example.com/app/key-1');
});

test('isValidRtmpUrl accepts rtmp:// and rtmps:// endpoints', () => {
  assert.equal(isValidRtmpUrl('rtmp://a.rtmp.youtube.com/live2'), true);
  assert.equal(isValidRtmpUrl('rtmps://ingest.example.com/app'), true);
});

test('isValidRtmpUrl rejects non-RTMP or malformed targets', () => {
  assert.equal(isValidRtmpUrl('http://evil.example.com/live'), false);
  assert.equal(isValidRtmpUrl('file:///etc/passwd'), false);
  assert.equal(isValidRtmpUrl('C:\\Videos\\stream.flv'), false);
  assert.equal(isValidRtmpUrl('/usr/share/stream.flv'), false);
  assert.equal(isValidRtmpUrl(''), false);
  assert.equal(isValidRtmpUrl(null), false);
  assert.equal(isValidRtmpUrl(undefined), false);
});

test('buildFfmpegArgs re-encodes to H.264/AAC and targets FLV on the RTMP URL', () => {
  const args = buildFfmpegArgs('webm', 'rtmp://ingest.example.com/app/key');
  assert.equal(args[args.length - 2], 'flv');
  assert.equal(args[args.length - 1], 'rtmp://ingest.example.com/app/key');
  assert.ok(args.includes('libx264'));
  assert.ok(args.includes('aac'));
  assert.equal(args[args.indexOf('-f') + 1], 'webm');
  assert.ok(args.includes('zerolatency'));
  assert.ok(args.includes('pipe:0'));
});