import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {BankLogoCatalog, bankLogoMarkup, institutionIcon, resolveBankLogo} from '../assets/bank-ui.js';
import {BankCatalog} from '../assets/data-engine.js';

test('every Android institution is represented with only local logo paths', async () => {
  assert.equal(BankLogoCatalog.length, BankCatalog.length);
  assert.deepEqual(BankLogoCatalog.map(bank => bank.id).sort(), BankCatalog.map(bank => bank.id).sort());
  const ids = new Set();
  for (const bank of BankLogoCatalog) {
    assert.ok(!ids.has(bank.id));
    ids.add(bank.id);
    if (!bank.src) {
      assert.equal(bank.id, 'jubilee-bank', 'only artwork missing in Android may use the generic fallback');
      continue;
    }
    assert.match(bank.src, /^\/assets\/banks\/[a-z0-9]+(?:-[a-z0-9]+)*\.(?:png|jpg|svg)$/);
    const file = new URL(`..${bank.src}`, import.meta.url);
    await access(file);
    const bytes = await readFile(file);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), bank.sha256, `${bank.id} must retain its original artwork bytes`);
    if (bank.mime === 'image/png') {
      assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
      assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], bank.logoSize, `${bank.id} dimensions must match the bundled Android logo`);
    }
    const markup = bankLogoMarkup({bankId: bank.id});
    assert.ok(markup.includes(`href="${bank.src}"`));
    assert.ok(!markup.includes('data:image') && !markup.includes('https://'), 'logos must not contact external image servers');
  }
});

test('original Android logo bytes and crop geometry are preserved when source is available', async context => {
  const source = new URL('../../Depositly/app/assets/index.html', import.meta.url);
  let html;
  try { html = await readFile(source, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') { context.skip('Android source checkout is not present beside this web checkout.'); return; } throw error; }
  const original = JSON.parse(html.match(/const BankCatalog=(\[[\s\S]*?\]);/)[1]);
  assert.equal(original.length, BankLogoCatalog.length);
  for (const bank of original) {
    const exported = resolveBankLogo({bankId: bank.id});
    assert.deepEqual(exported.symbolBox, bank.symbolBox || null);
    assert.deepEqual(exported.symbolClip, bank.symbolClip || null);
    if (bank.logo) {
      const bytes = Buffer.from(bank.logo.split(',')[1], 'base64');
      assert.equal(createHash('sha256').update(bytes).digest('hex'), exported.sha256);
    } else assert.equal(exported.src, null);
  }
});

test('bank id is authoritative and names and Android aliases restore older imports', () => {
  assert.equal(resolveBankLogo({bankId: 'brac-bank-plc', bankName: 'Sonali Bank PLC'}).id, 'brac-bank-plc');
  assert.equal(resolveBankLogo({bankName: '  Dutch-Bangla Bank PLC  '}).id, 'dutch-bangla-bank-plc');
  assert.equal(resolveBankLogo({bankName: 'DBBL'}).id, 'dutch-bangla-bank-plc');
  assert.equal(resolveBankLogo('HSBC').id, 'the-hong-kong-and-shanghai-banking-corporation-ltd');
  assert.equal(resolveBankLogo({bankName: 'National Credit & Commerce Bank PLC'}).id, 'national-credit-commerce-bank-plc');
  assert.equal(institutionIcon, bankLogoMarkup);
});

test('polygon crops and unique clip ids reproduce Android bank symbols', () => {
  const city = bankLogoMarkup({bankId: 'city-bank-plc'});
  assert.match(city, /viewBox="0 0 85 91"/);
  assert.match(city, /<polygon points="0,0 85,0 85,45 32,49 0,91"/);
  const social = bankLogoMarkup({bankId: 'social-islami-bank-plc'});
  assert.match(social, /viewBox="35 0 116 58"/);
  assert.match(social, /<polygon points="35,0 151,0 151,36 96,36 94,58 35,58"/);
  const first = city.match(/<clipPath id="([^"]+)"/)[1];
  const second = bankLogoMarkup({bankId: 'city-bank-plc'}).match(/<clipPath id="([^"]+)"/)[1];
  assert.notEqual(first, second, 'repeated logos on the same page must not share SVG clip ids');
  assert.ok(city.includes(`clip-path="url(#${first})"`));
});

test('existing original logos without Android symbol crops display their complete artwork', () => {
  for (const id of ['citibank-n-a', 'dhaka-bank-plc', 'export-import-bank-of-bangladesh-plc', 'habib-bank-ltd']) {
    const bank = resolveBankLogo(id), markup = bankLogoMarkup({bankId: id});
    assert.equal(bank.symbolBox, null);
    assert.ok(markup.includes(`viewBox="0 0 ${bank.logoSize.join(' ')}"`));
    assert.ok(markup.includes(`href="${bank.src}"`));
    assert.match(markup, /bank-logo--wordmark/);
  }
});

test('unknown and missing institutions use a safe accessible generic icon', () => {
  const asset = {bankId: '" onload="bad()', bankName: 'Custom & "<bank>"', logo: 'https://untrusted.example/logo.svg'};
  assert.equal(resolveBankLogo(asset), null);
  const markup = bankLogoMarkup(asset, {decorative: false});
  assert.match(markup, /bank-logo--fallback/);
  assert.match(markup, /aria-label="Custom &amp; &quot;&lt;bank&gt;&quot;"/);
  assert.ok(!markup.includes('<image') && !markup.includes('https://') && !markup.includes('onload='));
  assert.match(bankLogoMarkup({bankId: 'jubilee-bank'}), /bank-logo--fallback/);
  assert.match(bankLogoMarkup({bankId: 'brac-bank-plc'}), /aria-hidden="true"/);
  assert.match(bankLogoMarkup({bankId: 'brac-bank-plc'}, {decorative: false}), /role="img" aria-label="BRAC Bank PLC"/);
});
