let baseUrl, accessToken, user;
let context = {};

$(() => {
  initPopup();
  initContext()
  .then(updateRepo)
  .then(updateBranch)
  .then(() => {
    $('#commit').click((e) => {
      commit(getBookmarkParam());
    });
    $('.repo-menu-item').click((e) => {
      let target = $(e.target);
      const repoName = target.attr('data');
      chrome.storage.sync.set({'repository': repoName, 'branch': 'master'});
      $('.repo-menu-text').text(repoName);
      $('.branch-menu-text').text('master');
      updateBranch();
    });
    $('.branch-menu-item').click((e) => {
      let target = $(e.target);
      const branchName = target.attr('data');
      chrome.storage.sync.set({'branch': branchName});
      $('.branch-menu-text').text(branchName);
    })
  })
  .catch((err) => { $('#result').text($('#result').text() + ' : ' + err); });
});

var Base64 = {
  encode: function(str) {
    return btoa(unescape(encodeURIComponent(str)));
  },
  decode: function(str) {
    return decodeURIComponent(escape(atob(str)));
  }
};

function initPopup() {
  chrome.storage.sync.get(["repository", "branch", "filepath"], (item) => {
    $('.repo-menu-text').text(item.repository ? item.repository : '');
    $('.branch-menu-text').text(item.branch ? item.branch : '');
    $('#filepath').val(item.filepath ? item.filepath : '');
  });
  chrome.tabs.getSelected(window.id, function (tab) {
    $('#url').val(tab.url)
  });
}

function updateRepo() {
  return new Promise((resolve, reject) => {
    $.ajax({
      url: `${baseUrl}/user/repos?affiliation=owner`,
      headers: {Authorization: `token ${token}`}
    }).done((repos) => {
      repos.forEach((repo) => {
        let content = `<li><div class='repo-menu-item' data="${repo.name}">${repo.name}</div></li>`
        $('.repo-menu-contents').append(content);
      });
      resolve();
    }).fail((e) => { reject(`error update repo: ${JSON.stringify(e)}`) });
  })
}

function updateBranch(){
  return new Promise((resolve, reject) => {
    let repository = $('.repo-menu-text').text();
    $.ajax({
      url: `${baseUrl}/repos/${user}/${repository}/branches`,
      headers: {Authorization: `token ${token}`}
    }).done((branches) => {
      branches.forEach((branch) => {
        let content = `<li><div class='branch-menu-item' data="${branch.name}">${branch.name}</div></li>`
        $('.branch-menu-contents').append(content);
      });
      resolve();
    }).fail((e) => { reject(`error update branch: ${repository}: ${JSON.stringify(e)}`) });
  });
}

function getBookmarkParam() {
  const repository = $('.repo-menu-text').text();
  const branch = $('.branch-menu-text').text();
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
    if (!(context.name && context.email)) {
      context.name = branch['commit']['commit']['author']['name'];
      context.email = branch['commit']['commit']['author']['email'];
    }
    return get(`${repository}/git/trees/${branch['commit']['commit']['tree']['sha']}`)();
  })
  .then((tree) => {
    // $('#result').text($('#result').text() + ' : ' + 'aaa');
    return existContents(filepath, tree.tree, repository);
  })
  .then((exist) => {
    // $('#result').text($('#result').text() + ' : ' + JSON.stringify(exist));
    if (exist.ok) {
      return get(`${repository}/git/blobs/${exist.sha}`)();
    } else {
      return new Promise((resolve, reject) => { resolve({}) });
    }
  })
  .then((blob) => {
    // $('#result').text($('#result').text() + ' : ' + JSON.stringify(blob));
    var content = `- ${url} : ${message}`
    if (blob != {}) {
      content = Base64.decode(blob.content) + `\n${content}`;
    }
    var data = {
      'message': (message ? message : 'Bookmark!'),
      'committer': {
        'name': context.name,
        'email': context.email
      },
      'content': Base64.encode(content),
      'branch': branch
    }
    if (blob != {}) {
      data.sha = blob.sha;
    }
    return put(`${repository}/contents/${filepath}`, data)();
  })
  .then((data) => {
    $('#result').text('Succsess!: ' + JSON.stringify(data));
    chrome.storage.sync.set({'repository': repository, 'branch': branch, 'filepath': filepath});
  })
  .catch((err) => { $('#result').text($('#result').text() + ' : ' + err); });
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
      case 'PUT':
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
      var temp = `${endpoint}: ${JSON.stringify(jqXHR)}: ${textStatus}: ${errorThrown}`;
      reject(`REST API Error !!: ${temp}`);
    });
  });
}

function get(endpoint) {
  return function() { return fetch('GET', endpoint, null) };
}

function put(endpoint, data) {
  return function() { return fetch('PUT', endpoint, data) };
}

function post(endpoint, data) {
  return function() { return fetch('POST', endpoint, data) };
}

function patch(endpoint, data) {
  return function() { return fetch('PATCH', endpoint, data) };
}

function existContents(filepath, pTree, repository) {
  var loop = ((filepaths, index, pTree, resolve) => {
    var path = filepaths[index];
    // $('#result').text($('#result').text() + ` : ${index} ${path}`);
    var result = {};
    for (var i in pTree) {
      if (pTree[i].path == path) {
        if (i == filepaths.length - 1 && pTree[i].type == 'blob') {
          result = pTree[i]
          break;
        } else if (pTree[i].type == 'tree') {
          result = pTree[i]
          break;
        }
      }
    }
    switch (result.type) {
      case 'blob':
        resolve({ ok: true, sha: pTree[i].sha });
        break;
      case 'tree':
        $.ajax({
          url: `${baseUrl}/repos/${user}/${repository}/git/trees/${pTree[i].sha}`,
          headers : { Authorization: `token ${token}` }
        }).done((tree) => {
          loop(filepaths, index + 1, tree.tree, resolve);
        }).fail((jqXHR, textStatus, errorThrown) => {
          resolve({ ok: false });
        });
        break;
      default:
        resolve({ ok: false });
    }
  });

  return new Promise((resolve, reject) => {
    // $('#result').text($('#result').text() + ' : ' + JSON.stringify(filepath.split('/')));
    loop(filepath.split('/'), 0, pTree, resolve);
  });
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