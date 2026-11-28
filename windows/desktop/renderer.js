const api = window.companion;
const el = id => document.getElementById(id);

let busy = false;

function render(state) {
  el('status').textContent = state.status;
  el('address').value = state.address;

  el('startup').checked = state.startup;
  el('controls').checked = state.controls === true;

  el('toggle').textContent = state.stopped
    ? 'Start companion'
    : 'Stop companion';

  el('data').textContent = state.data;
  el('folders').replaceChildren();

  for (
    const [id, folder] of Object.entries(state.folders)
  ) {
    const li = document.createElement('li');

    const label = document.createElement('span');
    label.textContent = folder;

    const button = document.createElement('button');
    button.textContent = 'Remove';
    button.disabled = busy;

    button.onclick = () => {
      run(() => api.removeFolder(id));
    };

    li.append(label, button);
    el('folders').append(li);
  }
}

async function run(job) {
  if (busy) return;

  busy = true;
  el('error').textContent = '';

  document
    .querySelectorAll('button,input[type=checkbox]')
    .forEach(element => {
      element.disabled = true;
    });

  try {
    await job();
  } catch (error) {
    el('error').textContent = error.message;
  } finally {
    busy = false;

    document
      .querySelectorAll('button,input[type=checkbox]')
      .forEach(element => {
        element.disabled = false;
      });

    try {
      render(await api.state());
    } catch (error) {
      el('error').textContent = error.message;
    }
  }
}

el('add').onclick = () => {
  run(api.addFolder);
};

el('toggle').onclick = () => {
  run(api.toggleServer);
};

el('startup').onchange = () => {
  run(() => api.startup(el('startup').checked));
};

el('controls').onchange = () => {
  run(() => api.controls(el('controls').checked));
};

el('copy').onclick = () => {
  run(async () => {
    await api.copyToken();

    el('copy').textContent = 'Copied';

    setTimeout(() => {
      el('copy').textContent = 'Copy token';
    }, 2000);
  });
};

el('reveal').onclick = () => {
  run(async () => {
    const showing = el('token').type === 'text';

    el('token').type = showing ? 'password' : 'text';

    el('token').value = showing
      ? 'Hidden — use Reveal or Copy'
      : await api.revealToken();

    el('reveal').textContent = showing
      ? 'Reveal token'
      : 'Hide token';
  });
};

api.onState(render);

run(async () => {});