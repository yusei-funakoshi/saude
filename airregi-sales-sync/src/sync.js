#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { fetchDemaeSales } = require('./demaecan.js');
const { fetchMenuSales } = require('./menu.js');
const { fetchUberEatsSales } = require('./ubereats.js');
const { fetchRocketNowSales } = require('./rocketnow.js');
const { fetchAirRegiSales } = require('./airregi.js');
const { fetchAirShiftLaborCost } = require('./airshift.js');
const { postToGas } = require('./gas.js');

function today() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
}

async function run() {
  const args = process.argv.slice(2);
  const date = args.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a)) || today();
  const headful = args.includes('--headful');
  const configPath = args.includes('--config')
    ? args[args.indexOf('--config') + 1]
    : path.join(__dirname, '../config.json');

  if (!fs.existsSync(configPath)) {
    console.error(`Config not found: ${configPath}`);
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  console.log(`Syncing sales for ${date}\n`);

  for (const store of config.stores) {
    console.log(`=== ${store.name} ===`);
    const airregiPayload = {
      spreadsheetId: store.spreadsheetId,
      date,
      secret: config.gas.secret,
    };
    const deliveryPayload = {
      spreadsheetId: store.spreadsheetId,
      date,
      secret: config.gas.secret,
    };

    // AirRegi 売上
    if (store.airregiStoreName && config.airregi) {
      try {
        const { sales, tax, cashSales, customerCount } = await fetchAirRegiSales(
          date,
          { storeName: store.airregiStoreName },
          config.airregi,
          { headful }
        );
        airregiPayload.sales = sales;
        airregiPayload.tax = tax;
        airregiPayload.cashSales = cashSales;
        airregiPayload.customerCount = customerCount;
        const net = sales - tax;
        console.log(`  エアレジ:  売上 ¥${sales.toLocaleString()} 税抜 ¥${net.toLocaleString()} 現金 ¥${cashSales.toLocaleString()} 来客数 ${customerCount}人`);
      } catch (e) {
        console.warn(`  エアレジ:  ERROR - ${e.message}`);
      }
    }

    // AirShift 人件費
    if (store.airshiftStoreName && config.airregi) {
      try {
        const laborCost = await fetchAirShiftLaborCost(
          date,
          { storeName: store.airshiftStoreName },
          config.airregi,
          { headful }
        );
        airregiPayload.laborCost = laborCost;
        console.log(`  エアシフト: 人件費 ¥${laborCost.toLocaleString()}`);
      } catch (e) {
        console.warn(`  エアシフト: ERROR - ${e.message}`);
      }
    }

    // Post AirRegi + AirShift to GAS
    if (airregiPayload.sales !== undefined || airregiPayload.laborCost !== undefined) {
      try {
        const result = await postToGas(config.gas.url, airregiPayload);
        if (result.ok) {
          console.log(`  → GAS (売上/人件費): written`);
        } else {
          console.warn(`  → GAS (売上/人件費): ${JSON.stringify(result)}`);
        }
      } catch (e) {
        console.warn(`  → GAS (売上/人件費): ERROR - ${e.message}`);
      }
    }

    // 出前館
    if (store.demaecan) {
      try {
        const sales = await fetchDemaeSales(date, store.demaecan, { headful });
        deliveryPayload.demaeSales = sales;
        console.log(`  出前館:    ¥${sales.toLocaleString()}`);
      } catch (e) {
        console.warn(`  出前館:    ERROR - ${e.message}`);
      }
    }

    // MENU
    if (store.menu) {
      try {
        const sales = await fetchMenuSales(date, store.menu, config.menu);
        deliveryPayload.menuSales = sales;
        console.log(`  MENU:      ¥${sales.toLocaleString()}`);
      } catch (e) {
        console.warn(`  MENU:      ERROR - ${e.message}`);
      }
    }

    // Uber Eats
    if (store.ubereats) {
      try {
        const sales = await fetchUberEatsSales(date, store.ubereats, config.ubereats, { headful });
        deliveryPayload.uberEatsSales = sales;
        console.log(`  Uber Eats: ¥${sales.toLocaleString()}`);
      } catch (e) {
        console.warn(`  Uber Eats: ERROR - ${e.message}`);
      }
    }

    // Rocket Now
    if (store.rocketnow) {
      try {
        const sales = await fetchRocketNowSales(date, store.rocketnow, config.rocketnow, { headful });
        deliveryPayload.rocketNowSales = sales;
        console.log(`  Rocket Now: ¥${sales.toLocaleString()}`);
      } catch (e) {
        console.warn(`  Rocket Now: ERROR - ${e.message}`);
      }
    }

    // Post delivery data to GAS
    const hasDelivery = deliveryPayload.demaeSales !== undefined
      || deliveryPayload.menuSales !== undefined
      || deliveryPayload.uberEatsSales !== undefined
      || deliveryPayload.rocketNowSales !== undefined;

    if (hasDelivery) {
      try {
        const result = await postToGas(config.gas.url, deliveryPayload);
        if (result.ok) {
          console.log(`  → GAS (デリバリー): written`);
        } else {
          console.warn(`  → GAS (デリバリー): ${JSON.stringify(result)}`);
        }
      } catch (e) {
        console.warn(`  → GAS (デリバリー): ERROR - ${e.message}`);
      }
    }

    console.log('');
  }
}

run().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
