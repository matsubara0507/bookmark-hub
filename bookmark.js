let baseUrl, accessToken, user;
let context = {};

$(() => {
  initPopup();
  $('#commit').click((e) => {
    commit(getBookmarkParam());
  });
});

function initPopup() {
  chrome.storage.sync.get(["repository", "branch", "filepath"], (item) => {
    $('#repository').val(item.repository ? item.repository : '');
    $('#branch').val(item.branch ? item.branch : '');
    $('#filepath').val(item.filepath ? item.filepath : '');
  });
  chrome.tabs.getSelected(window.id, function (tab) {
    $('#url').val(tab.url)
  });
}

function getBookmarkParam() {
  const repository = $('#repository').val();
  const branch = $('#branch').val();
  const filepath = $('#filepath').val();
  const url = $('#url').val();
  const message = $('#message').val();
  return {
    repository,
    branch,
    filepath,
    url,
    message,
  };
}

function commit(param) {
  const repository = param.repository;
  const branch = param.branch;
  const filepath = param.filepath;
  const url = param.url;
  const message = param.message;
  initContext()
  .then(initUserInfo)
  .then(get(`${repository}/branches/${branch}`))
  .then((branch) => {
    context.parentSha = branch['commit']['sha'];
    if (!(context.name && context.email)) {
      context.name = branch['commit']['commit']['author']['name'];
      context.email = branch['commit']['commit']['author']['email'];
    }
    return get(`${repository}/git/trees/${branch['commit']['commit']['tree']['sha']}`)();
  })
  .then((pTree) => {
    context.pastTree = pTree['tree'];
    var content = `- ${url} : ${message}`
    return post(`${repository}/git/blobs`, { 'content': content, 'encoding': 'utf-8' })();
  })
  .then((blob) => {
    return post(`${repository}/git/trees`, {
      'tree': context.pastTree.concat([{
        'path': `bookmarks/${filepath}.md`,
        'mode': '100644',
        'type': 'blob',
        'sha': blob['sha']
      }])
    })();
  })
  .then((tree) => {
    return post(`${repository}/git/commits`, {
      'message': message ? message : 'Bookmark!',
      'author': {
        'name': context.name,
        'email': context.email,
        'date': formatISO8601(new Date())
      },
      'parents': [context.parentSha],
      'tree': tree['sha']
    })();
  })
  .then((commit) => {
    return patch(`${repository}/git/refs/heads/${branch}`, { 'sha': commit['sha'] })();
  })
  .then((data) => {
    $('#result').val(data['url']);
    chrome.storage.sync.set({'repository': repository, 'branch': branch, 'filepath': filepath});
  })
  .catch((err) => { $('#result').val(err); });
}

function initContext() {
  content = {};
  return new Promise((resolve, reject) => {
    chrome.storage.sync.get(["token", "user", "baseUrl"], (item) => {
      if (!item.token) {
        reject(new Error("need login"));
      }
      token = item.token;
      user = item.user;
      baseUrl = item.baseUrl;
      resolve();
    });
  });
}

function initUserInfo() {
  return new Promise((resolve, reject) => {
    var params = {
      url: `${baseUrl}/users/${user}`,
      headers : { Authorization: `token ${token}` }
    };
    $.ajax(params)
    .done((data) => {
      context.name = data['name'];
      context.email = data['email'];
      resolve();
    });
  });
}

function fetch(method, endpoint, data) {
  return new Promise((resolve, reject) => {
    var params;
    switch (method) {
      case 'GET':
        params = {
          url: `${baseUrl}/repos/${user}/${endpoint}`,
          headers : { Authorization: `token ${token}` }
        };
        break;
      case 'POST':
      case 'PATCH':
        params = {
          url: `${baseUrl}/repos/${user}/${endpoint}`,
          headers: {
            Authorization: `token ${token}`
          },
          method: method,
          crossDomain: true,
          dataType: 'json',
          contentType: 'application/json',
          data: JSON.stringify(data)
        };
        break;
      default:
        throw 'undefined HTTP method: ' + method;
    }
    $.ajax(params)
    .done((data) => {
      resolve(data);
    }).fail((jqXHR, textStatus, errorThrown) => {
      var temp = `${endpoint}: ${jqXHR.status}: ${textStatus}: ${errorThrown}`;
      reject(`REST API Error !!: ${temp}: ${context.name}: ${context.email}`);
    });
  });
}

function get(endpoint) {
  return function() { return fetch('GET', endpoint, null) };
}

function post(endpoint, data) {
  return function() { return fetch('POST', endpoint, data) };
}

function patch(endpoint, data) {
  return function() { return fetch('PATCH', endpoint, data) };
}

function formatISO8601(date) {
 var offset = (function (d) {
   var o = d.getTimezoneOffset() / -60;
    return ((0 < o) ? '+' : '-') + ('00' + Math.abs(o)).substr(-2) + ':00';
  })(date);

  return [
   [
     date.getFullYear(),
      ('00' + (date.getMonth() + 1)).substr(-2),
      ('00' + date.getDate()).substr(-2)
    ].join('-'),
    'T',
    [
      ('00' + date.getHours()).substr(-2),
      ('00' + date.getMinutes()).substr(-2),
      ('00' + date.getSeconds()).substr(-2)
    ].join(':'),
    offset
  ].join('');
}
