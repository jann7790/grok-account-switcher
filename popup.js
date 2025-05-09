const domain = 'grok.com';

// Execute scripts on the grok page directly
const execOnPage = (tabId, fn, args = []) =>
  chrome.scripting.executeScript({ target: { tabId }, function: fn, args })
    .then(([res]) => res.result);

// Save current account (corrected)
async function saveCurrentAccount() {
  const name = document.getElementById('accountName').value.trim();
  if (!name) return alert('Enter account name first.');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab.url.startsWith(`https://${domain}`)) {
    return alert(`Please open grok (${domain}) website first.`);
  }

  const cookies = await chrome.cookies.getAll({ domain });
  const storages = await execOnPage(tab.id, () => {
    const local = {...localStorage};
    // Clear STATSIG values
    if (local.STATSIG_LOCAL_STORAGE_LOGGING_REQUEST) {
      local.STATSIG_LOCAL_STORAGE_LOGGING_REQUEST = '';
    }
    if (local.STATSIG_LOCAL_STORAGE_INTERNAL_STORE_V4) {
      local.STATSIG_LOCAL_STORAGE_INTERNAL_STORE_V4 = '';
    }
    return {
      local,
      session: {...sessionStorage},
    };
  });

  chrome.storage.local.get(['accounts'], ({ accounts = {} }) => {
    accounts[name] = { cookies, storages };
    chrome.storage.local.set({ accounts, currentAccount: name }, () => {
      renderAccounts(accounts, name);
      alert(`Saved account "${name}" successfully.`);
      document.getElementById('accountName').value = '';
    });
  });
}

async function switchAccount(name) {
  chrome.storage.local.get(['accounts'], async ({ accounts = {} }) => {
    const data = accounts[name];
    if (!data) return alert('Account data missing.');

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab.url.startsWith(`https://${domain}`)) {
      return alert(`Please open grok (${domain}) website first.`);
    }

    // Update the UI immediately to show the new current account
    renderAccounts(accounts, name);

    const existingCookies = await chrome.cookies.getAll({ domain });
    await Promise.all(existingCookies.map(c =>
      chrome.cookies.remove({
        url: `https://${domain}${c.path}`,
        name: c.name
      })
    ));

    await Promise.all(data.cookies.map(c => {
      const cookieDetails = {
        url: `https://${domain}${c.path}`,
        name: c.name,
        value: c.value,
        path: c.path,
        secure: c.secure,
        httpOnly: c.httpOnly,
        sameSite: c.sameSite,
        expirationDate: c.expirationDate,
      };

      if (!c.name.startsWith('__Host-')) {
        cookieDetails.domain = c.domain;
      } else {
        cookieDetails.path = '/';
        cookieDetails.secure = true;
      }

      return chrome.cookies.set(cookieDetails);
    }));

    await execOnPage(tab.id, ({local, session}) => {
      localStorage.clear();
      sessionStorage.clear();
      Object.entries(local).forEach(([k, v]) => {
        if (k === 'STATSIG_LOCAL_STORAGE_LOGGING_REQUEST' || 
            k === 'STATSIG_LOCAL_STORAGE_INTERNAL_STORE_V4') {
          localStorage.setItem(k, '');
        } else {
          localStorage.setItem(k, v);
        }
      });
      Object.entries(session).forEach(([k, v]) => sessionStorage.setItem(k, v));
    }, [data.storages]);

    // Store current account name
    chrome.storage.local.set({ currentAccount: name }, () => {
      chrome.tabs.reload(tab.id);
    });
  });
}

// Delete account
function deleteAccount(name) {
  chrome.storage.local.get(['accounts', 'currentAccount'], ({ accounts = {}, currentAccount }) => {
    delete accounts[name];
    // If we're deleting the current account, clear the currentAccount
    const newCurrentAccount = (currentAccount === name) ? null : currentAccount;
    chrome.storage.local.set({ accounts, currentAccount: newCurrentAccount }, () => {
      renderAccounts(accounts, newCurrentAccount);
    });
  });
}

// Add this helper function before renderAccounts
function calculateSize(obj) {
  const str = JSON.stringify(obj);
  // Calculate size in KB
  return (str.length / 1024).toFixed(2);
}

// Render account list
function renderAccounts(accounts, currentAccount) {
  const list = document.getElementById('accountList');
  list.innerHTML = ''; // Clear previous list items

  // Add current account indicator at the top
  if (currentAccount) {
    const currentAccountDiv = document.createElement('div');
    currentAccountDiv.id = 'currentAccount';
    currentAccountDiv.innerHTML = `Current account: <strong>${currentAccount}</strong>`;
    currentAccountDiv.classList.add('current-account-indicator');
    list.appendChild(currentAccountDiv);
  }

  for (const name of Object.keys(accounts)) {
    const li = document.createElement('li');
    
    // Add active class if this account is the current one
    if (name === currentAccount) {
      li.classList.add('active-account');
    }

    const nameSpan = document.createElement('span'); // Create a span for the name
    nameSpan.textContent = name;
    li.appendChild(nameSpan);

    const buttonContainer = document.createElement('div'); // Container for buttons

    const switchBtn = document.createElement('button');
    switchBtn.textContent = 'Switch';
    switchBtn.onclick = () => switchAccount(name);
    buttonContainer.appendChild(switchBtn);

    const delBtn = document.createElement('button');
    delBtn.textContent = 'Delete';
    delBtn.onclick = () => deleteAccount(name);
    buttonContainer.appendChild(delBtn);

    li.appendChild(buttonContainer); // Add button container to li
    list.appendChild(li);
  }
}

// Clear all accounts
const clearAllButton = document.getElementById('clearAll');
if (clearAllButton) {
  clearAllButton.onclick = () =>
    chrome.storage.local.set({ accounts: {}, currentAccount: null }, () => renderAccounts({}, null));
}

// Initialize popup UI
document.getElementById('saveAccount').onclick = saveCurrentAccount;
chrome.storage.local.get(['accounts', 'currentAccount'], ({accounts = {}, currentAccount}) => {
  renderAccounts(accounts, currentAccount);
});

// Create "Show Storage Usage" button
const usageBtn = document.createElement('button');
usageBtn.textContent = 'Show Storage Usage';
usageBtn.onclick = () => {
  chrome.storage.local.get(['accounts'], ({ accounts = {} }) => {
    if (Object.keys(accounts).length === 0) {
      alert('No accounts saved. Storage is empty.');
      return;
    }
    const totalSize = calculateSize(accounts);
    alert(`Storage Usage:\n\n` +
          `Total: ${totalSize}KB / 10,240KB (10MB limit)\n\n` +
          Object.entries(accounts)
            .map(([name, data]) => `${name}: ${calculateSize(data)}KB`)
            .join('\n'));
  });
};

// Create "Clear Current grok.com Cookies" button
const clearCookiesBtn = document.createElement('button');
clearCookiesBtn.textContent = 'Clear Cookies';
clearCookiesBtn.style.backgroundColor = 'green';
clearCookiesBtn.style.color = 'white';
clearCookiesBtn.onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab.url.startsWith(`https://${domain}`)) {
    return alert(`Please open grok (${domain}) website first.`);
  }
  const existingCookies = await chrome.cookies.getAll({ domain });
  await Promise.all(existingCookies.map(c =>
    chrome.cookies.remove({
      url: `https://${domain}${c.path}`,
      name: c.name
    })
  ));
  
  // Reset current account
  chrome.storage.local.get(['accounts'], ({ accounts = {} }) => {
    chrome.storage.local.set({ currentAccount: null }, () => {
      renderAccounts(accounts, null);
      alert('All current grok.com cookies have been cleared and account reset.');
      chrome.tabs.reload(tab.id);
    });
  });
};

// Group "Show Storage Usage", "Clear All Accounts", and "Clear Current grok.com Cookies" buttons
if (clearAllButton && clearAllButton.parentNode) {
  const bottomControlsContainer = document.createElement('div');
  bottomControlsContainer.style.display = 'center';
  bottomControlsContainer.style.justifyContent = 'space-between'; // Adjust as needed e.g. 'flex-start'
  bottomControlsContainer.style.alignItems = 'center';
  // bottomControlsContainer.style.marginTop = '10px'; // Add some space above the container

  // Insert the new container in place of the original clearAllButton's position
  clearAllButton.parentNode.insertBefore(bottomControlsContainer, clearAllButton);

  // Add the new usage button to the container
  bottomControlsContainer.appendChild(usageBtn);
  // Add the new clear cookies button to the container
  bottomControlsContainer.appendChild(clearCookiesBtn);
  // Move the existing clearAllButton into the container
  bottomControlsContainer.appendChild(clearAllButton);

  // Optionally, add some spacing between buttons if not handled by justify-content
  usageBtn.style.marginRight = '10px'; 
  clearCookiesBtn.style.marginRight = '10px';
}
