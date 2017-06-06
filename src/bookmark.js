"use strict";

let github;
let context = {};

$(() => {
  initContext()
  .then(updateRepo)
  .then(initPopup)
  .then(updateBranch)
  .then(() => {
    return new Promise((resolve) => {
      chrome.storage.sync.get(["branch"], (item) => {
        $('#branch').val(item.branch ? item.branch : '');
        resolve();
      });
    });
  })
  .then(() => {
    $('#commit').click(() => {
      runBookmark(getBookmarkParam());
    });
    $('select#repo').change(() => {
      const repoName = $('#repo').val();
      chrome.storage.sync.set({'repository': repoName});
      github.repo = repoName;
      updateBranch().then(() => {
        chrome.storage.sync.set({'branch': $('#branch').val()});
      });
    });
    $('select#branch').change(() => {
      chrome.storage.sync.set({'branch': $('#branch').val()});
    });
  })
  .catch((err) => { $('#result').text($('#result').text() + ' : ' + err); });
});

function initContext() {
  context = {};
  return new Promise((resolve, reject) => {
    chrome.storage.sync.get(["token", "user", "baseUrl", "repository"], (item) => {
      if (!item.token) {
        reject(new Error("need login"));
      }
      github = new GitHubAPI(
        item.baseUrl,
        item.user,
        item.repository,
        item.token
      );
      resolve();
    });
  });
}

function initPopup() {
  return new Promise((resolve) => {
    chrome.tabs.getSelected(window.id, function (tab) {
      $('#url').val(tab.url);
    });
    chrome.storage.sync.get(["repository", "filepath"], (item) => {
      $('#repo').val(item.repository ? item.repository : '');
      $('#filepath').val(item.filepath ? item.filepath : '');
      resolve();
    });
  });
}

function checkGitHubAPI(data = {}) {
  return new Promise(function(resolve, reject) {
    if (github === undefined) {
      reject('GitHubAPI object is undefined.');
    } else {
      resolve(data);
    }
  });
}

function updateRepo() {
  return checkGitHubAPI()
  .then(github.get(`user/repos?affiliation=owner`))
  .then((repos) => {
    return new Promise((resolve) => {
      $('.repo-menu').empty();
      repos.forEach((repo) => {
        let content = `<option class='repo-menu-item' data="${repo.name}">${repo.name}</option>`;
        $('.repo-menu').append(content);
      });
      resolve();
    });
  });
}

function updateBranch(){
  return checkGitHubAPI()
  .then(github.get(`repos/${github.user}/${github.repo}/branches`))
  .then((branches) => {
    return new Promise(function(resolve) {
      $('.branch-menu').empty();
      branches.forEach((branch) => {
        let content = `<option class='branch-menu-item' data="${branch.name}">${branch.name}</option>`;
        $('.branch-menu').append(content);
      });
      resolve();
    });
  });
}

function getBookmarkParam() {
  const repository = $('#repo').val();
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

function runBookmark(param) {
  const repository = param.repository;
  const branch = param.branch;
  const filepath = param.filepath;
  const url = param.url;
  const message = param.message;
  initContext()
  .then(initUserInfo)
  .then(checkGitHubAPI)
  .then(() => new Promise((resolve) => { github.repo = repository; resolve(); }))
  .then(github.get(`repos/${github.user}/${github.repo}/branches/${branch}`))
  .then(branch => {
    if (!(context.name && context.email)) {
      context.name = branch.commit.commit.author.name;
      context.email = branch.commit.commit.author.email;
    }
    return github.get(`repos/${github.user}/${github.repo}/git/trees/${branch.commit.commit.tree.sha}`)();
  })
  .then(tree => existContents(filepath, tree.tree, repository))
  .then(exist => {
    if (exist.ok) {
      return github.get(`repos/${github.user}/${github.repo}/git/blobs/${exist.sha}`)();
    } else {
      return new Promise(resolve => { resolve({}); });
    }
  })
  .then(blob => {
    var data = {}, content = `- ${url} : ${message}`;
    if (blob.content) {
      content = Base64.decode(blob.content) + `\n${content}`;
      data.sha = blob.sha;
    }
    $.extend(data, {
      'message': (message ? message : 'Bookmark!'),
      'committer': {
        'name': context.name,
        'email': context.email
      },
      'content': Base64.encode(content),
      'branch': branch
    });
    return github.put(`repos/${github.user}/${github.repo}/contents/${filepath}`, data)();
  })
  .then(() => {
    $('#result').text('Succsess!');
    chrome.storage.sync.set({'repository': repository, 'branch': branch, 'filepath': filepath});
  })
  .catch((err) => { $('#result').text($('#result').text() + ' : ' + err); });
}

function initUserInfo() {
  return checkGitHubAPI()
  .then(github.get(`users/${github.user}`))
  .then(user => {
    return new Promise(resolve => {
      context.name = user.name;
      context.email = user.email;
      resolve();
    });
  });
}

function existContents(filepath, pTree) {
  var loop = (function (filepaths, index, pTree, resolve) {
    var path = filepaths[index];
    var result = {};
    for (var i in pTree) {
      if (pTree[i].path.toString() === path.toString()) {
        if (i - 0 === filepaths.length - 1 && pTree[i].type.toString() === 'blob') {
          result = pTree[i];
          break;
        } else if (pTree[i].type.toString() === 'tree') {
          result = pTree[i];
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
          url: `${github.baseUrl}/repos/${github.user}/${github.repo}/git/trees/${pTree[i].sha}`,
          headers : { Authorization: `token ${github.token}` }
        }).done((tree) => {
          loop(filepaths, index + 1, tree.tree, resolve);
        }).fail(() => {
          resolve({ ok: false });
        });
        break;
      default:
        resolve({ ok: false });
    }
  });

  return new Promise((resolve) => {
    loop(filepath.split('/'), 0, pTree, resolve);
  });
}
