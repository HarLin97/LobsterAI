const output = document.querySelector('#output');

const show = value => {
  output.textContent = JSON.stringify(value, null, 2);
};

const invoke = async callback => {
  try {
    if (!window.lobsterActivity) {
      throw new Error('window.lobsterActivity is unavailable');
    }
    show(await callback(window.lobsterActivity));
  } catch (error) {
    show({ error: error instanceof Error ? error.message : String(error) });
  }
};

document.querySelector('#runtime').addEventListener(
  'click',
  () => invoke(bridge => bridge.getRuntimeContext()),
);
document.querySelector('#context').addEventListener(
  'click',
  () => invoke(bridge => bridge.getActivityContext()),
);
document.querySelector('#action').addEventListener(
  'click',
  () => invoke(bridge => bridge.executeAction({
    actionId: 'check_in',
    idempotencyKey: crypto.randomUUID(),
  })),
);
document.querySelector('#login').addEventListener(
  'click',
  () => invoke(bridge => bridge.requestLogin()),
);
document.querySelector('#close').addEventListener(
  'click',
  () => invoke(bridge => bridge.close()),
);

window.lobsterActivity?.onAuthChanged(event => {
  show({ event: 'authChanged', ...event });
});
