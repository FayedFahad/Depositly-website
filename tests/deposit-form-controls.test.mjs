import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {draftDeposit, depositFormChoices} from '../assets/deposit-form.js';
import {Transfer, emptyState} from '../assets/data-engine.js';

const source = fs.readFileSync(new URL('../assets/app.js', import.meta.url), 'utf8');
const controlsSource = source.slice(source.indexOf('function syncAssetForm('), source.indexOf('function receiptForm('));
function form(values) {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {value:'', checked:false, disabled:false, required:false, hidden:false, dataset:{}});
    return nodes.get(id);
  };
  for (const [id, value] of Object.entries(values)) node(id).value = String(value);
  node('asset-form').elements = {namedItem:node};
  const context = vm.createContext({$:node, updateAssetPreview(){}});
  vm.runInContext(controlsSource, context);
  return {node, change(id, value) {node(id).value = String(value); vm.runInContext(`syncAssetForm(${JSON.stringify(id)})`, context);}, sync() {vm.runInContext('syncAssetForm()', context);}};
}

test('website controls preserve independent payout and tenure choices, including both Custom fields', () => {
  const payouts = [['1',1,'months'], ['3',3,'months'], ['100',100,'days'], ['custom',30,'days'], ['custom',100,'days'], ['custom',5,'months']];
  const tenures = [['1year',1,'years'], ['100days',100,'days'], ['custom',100,'days'], ['custom',180,'days'], ['custom',8,'months']];
  for (const type of ['FDR','NSC']) for (const [payout, count, unit] of payouts) for (const [tenure, length, termUnit] of tenures) {
    const ui = form({type, interestType:'simple', payoutChoice:payout, customPayoutCount:count, customPayoutUnit:unit, tenureChoice:tenure, customTenureCount:length, customTenureUnit:termUnit});
    for (const field of ['payoutChoice', 'tenureChoice', 'customPayoutCount', 'customTenureCount', 'start']) {
      ui.change(field, ui.node(field).value);
      assert.equal(ui.node('payoutChoice').value, payout);
      assert.equal(ui.node('tenureChoice').value, tenure);
      assert.equal(ui.node('customPayoutCount').value, String(count));
      assert.equal(ui.node('customPayoutUnit').value, unit);
      assert.equal(ui.node('customTenureCount').value, String(length));
      assert.equal(ui.node('customTenureUnit').value, termUnit);
      assert.equal(ui.node('autoRenew').checked, false);
      assert.equal(ui.node('customPayout').hidden, payout !== 'custom');
      assert.equal(ui.node('customTenure').hidden, tenure !== 'custom');
    }
    const input = {type, interestType:'simple', name:'Independent deposit', ownerName:'Sample Holder', ownership:'self', principal:'100000', rate:'8', tds:'10', start:'2026-10-01', payoutChoice:payout, customPayoutCount:count, customPayoutUnit:unit, tenureChoice:tenure, customTenureCount:length, customTenureUnit:termUnit};
    const saved = {...draftDeposit(input), id:'independent'};
    const reopened = Transfer.migrate(Transfer.exportData({...emptyState(), assets:[saved]})).assets[0];
    assert.equal(reopened.cycle, count);
    assert.equal(reopened.cycleUnit, unit);
    assert.equal(reopened.tenureCount, length);
    assert.equal(reopened.tenureUnit, termUnit);
    const edited = draftDeposit({...input, ...depositFormChoices(reopened)}, reopened);
    assert.equal(edited.cycle, count);
    assert.equal(edited.tenureCount, length);
  }
});

test('changing presets seeds only its own Custom controls', () => {
  const ui = form({type:'FDR', interestType:'simple', payoutChoice:'3', tenureChoice:'1year'});
  ui.sync();
  ui.change('payoutChoice', '100'); ui.change('payoutChoice', 'custom');
  assert.equal(ui.node('tenureChoice').value, '1year');
  assert.equal(ui.node('customPayoutCount').value, '100');
  ui.change('customPayoutCount', '30');
  ui.change('tenureChoice', '100days'); ui.change('tenureChoice', 'custom');
  assert.equal(ui.node('payoutChoice').value, 'custom');
  assert.equal(ui.node('customPayoutCount').value, '30');
  assert.equal(ui.node('customTenureCount').value, '100');
  ui.change('customTenureCount', '180');
  assert.equal(ui.node('customPayoutCount').value, '30');
});

test('compound maturity payouts and certificate renewal rules remain intact', () => {
  const ui = form({type:'FDR', interestType:'compound', payoutChoice:'custom', tenureChoice:'custom', customTenureCount:'180', customTenureUnit:'days'});
  ui.sync();
  assert.equal(ui.node('payoutChoice').disabled, true);
  assert.equal(ui.node('payoutChoice-field').hidden, true);
  ui.change('interestType', 'simple');
  assert.equal(ui.node('payoutChoice').disabled, false);
  assert.equal(ui.node('payoutChoice').value, 'custom');
  ui.node('autoRenew').checked = true;
  ui.change('type', 'NSC');
  assert.equal(ui.node('autoRenew').checked, false);
  assert.equal(ui.node('autoRenew').disabled, true);
});
