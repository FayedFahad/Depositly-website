import test from 'node:test';
import assert from 'node:assert/strict';
import {accountAvatar, accountButtonContent, accountDisplayName} from '../assets/account-ui.js';

test('the connected account chip shows the full Google name, photo and explicit status', () => {
  const user = {name: '  Farah   Rahman  ', given_name: 'Farah', email: 'farah@example.com', picture: 'https://lh3.googleusercontent.com/profile/photo?s=96'};
  const markup = accountButtonContent(user);
  assert.equal(accountDisplayName(user), 'Farah Rahman');
  assert.match(markup, /class="account-name">Farah Rahman<\/span>/);
  assert.match(markup, /Google connected/);
  assert.match(markup, /src="https:\/\/lh3\.googleusercontent\.com\/profile\/photo\?s=96"/);
  assert.match(markup, /alt=""/);
  assert.match(markup, /referrerpolicy="no-referrer"/);
  assert.match(markup, /data-account-photo/);
  assert.doesNotMatch(markup, /onerror=/);
  assert.match(accountButtonContent(user, {busy: true}), /Google connected · Updating…/);
});

test('missing photos retain initials with full-name and email fallbacks', () => {
  assert.match(accountAvatar({name: 'Farah Rahman'}), />FR<\/span>/);
  assert.doesNotMatch(accountAvatar({name: 'Farah Rahman'}), /<img/);
  assert.equal(accountDisplayName({given_name: 'Farah', family_name: 'Rahman'}), 'Farah Rahman');
  assert.equal(accountDisplayName({email: 'farah@example.com'}), 'farah@example.com');
  assert.equal(accountDisplayName(undefined), 'Google account');
  assert.match(accountAvatar(undefined), />GA<\/span>/);
  assert.match(accountAvatar({name: 'নাদিয়া রহমান'}), />নর<\/span>/);
});

test('profile fields cannot create HTML or image attribute handlers', () => {
  const markup = accountButtonContent({name: '<img src=x onerror="alert(1)"> & \'Name\'', picture: 'https://example.com/photo?x=" onerror="alert(1)&y=2'});
  assert.match(markup, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt; &amp; &#39;Name&#39;/);
  assert.doesNotMatch(markup, /<img src=x/);
  assert.doesNotMatch(markup, /" onerror="/);
  assert.match(markup, /%22/);
  assert.match(markup, /&amp;y=2/);
});

test('only absolute HTTPS pictures without embedded credentials are included', () => {
  for (const picture of ['javascript:alert(1)', 'data:image/svg+xml,<svg/>', 'http://example.com/photo.png', '//example.com/photo.png', '/photo.png', 'https://user:secret@example.com/photo.png', 'https://user@example.com/photo.png', 'not a URL', '', null, {}]) {
    assert.doesNotMatch(accountAvatar({name: 'Test Person', picture}), /<img/, String(picture));
  }
  assert.match(accountAvatar({name: 'Test Person', picture: 'https://example.com/photo.png'}), /<img/);
});

test('avatar sizing accepts bounded integers and rejects style injection', () => {
  assert.match(accountAvatar({name: 'Farah Rahman'}, {size: 48}), /--account-avatar-size:48px/);
  for (const size of [0, 97, -1, 34.5, '34; color:red', Infinity]) {
    const markup = accountAvatar({name: 'Farah Rahman'}, {size});
    assert.match(markup, /--account-avatar-size:34px/);
    assert.doesNotMatch(markup, /color:red/);
  }
});
