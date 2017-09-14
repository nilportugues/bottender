import path from 'path';
import { execSync } from 'child_process';

import inquirer from 'inquirer';
import validateProjectName from 'validate-npm-package-name';
import fs from 'fs-extra';
import spawn from 'cross-spawn';

import { print, error, bold } from '../../shared/log';

import generateIndexFile from './generateIndexFile';

const questions = [
  {
    name: 'name',
    message: "What's your project name?",
    type: 'input',
  },
  {
    name: 'platform',
    message: 'What platform of bot do you want to create?',
    type: 'list',
    choices: ['messenger', 'line', 'slack', 'telegram', 'console'],
  },
  {
    name: 'session',
    message: 'Where do you want to store session?',
    type: 'list',
    choices: ['memory', 'file', 'redis', 'mongo'],
  },
  {
    when: answer => answer.platform !== 'console',
    name: 'server',
    message: 'What kind of server do you want to use?',
    type: 'list',
    choices: ['express', 'koa', 'micro', 'restify'],
  },
];

const generateBotJson = platform => {
  const accessToken = '__PUT_YOUR_ACCESS_TOKEN_HERE__';
  switch (platform) {
    case 'slack':
      return {
        slack: {
          accessToken,
        },
      };
    case 'line':
      return {
        LINE: {
          accessToken,
          channelSecret: '__PUT_YOUR_CHANNEL_SECRET_HERE__',
        },
      };
    case 'telegram':
      return {
        telegram: {
          accessToken,
        },
      };
    case 'messenger':
    default:
      return {
        messenger: {
          accessToken,
          verifyToken: '__PUT_YOUR_VERITY_TOKEN_HERE__',
          appId: '__PUT_YOUR_APP_ID_HERE__',
          appSecret: '__PUT_YOUR_APP_SECRET_HERE__',
        },
      };
  }
};

const shouldUseYarn = () => {
  try {
    execSync('yarnpkg --version', { stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
};

const isSafeToCreateProjectIn = (root, name) => {
  const validFiles = [
    '.DS_Store',
    'Thumbs.db',
    '.git',
    '.gitignore',
    '.idea',
    'README.md',
    'LICENSE',
    'web.iml',
    '.hg',
    '.hgignore',
    '.hgcheck',
  ];
  print('');

  const conflicts = fs
    .readdirSync(root)
    .filter(file => !validFiles.includes(file));

  if (conflicts.length < 1) {
    return true;
  }

  print(`The directory ${name} contains files that could conflict:`);
  print('');

  // eslint-disable-next-line no-restricted-syntax
  for (const file of conflicts) {
    print(`  ${file}`);
  }
  print('');
  print(
    'Either try using a new directory name, or remove the files listed above.'
  );

  return false;
};

const printValidationResults = results => {
  if (typeof results !== 'undefined') {
    results.forEach(Error => {
      error(`  *  ${Error}`);
    });
  }
};

const checkBotName = botName => {
  const validationResult = validateProjectName(botName);
  if (!validationResult.validForNewPackages) {
    error(
      `Could not create a project called "${botName}" because of npm naming restrictions:`
    );
    printValidationResults(validationResult.errors);
    printValidationResults(validationResult.warnings);
    return false;
  }
  return true;
};

const install = (useYarn, allDependencies) =>
  new Promise((resolve, reject) => {
    let command;
    let args = [];
    if (useYarn) {
      command = 'yarnpkg';
      args = args.concat(['add', '--exact'], allDependencies.dependencies);
      spawn(command, args, { stdio: 'inherit' });
      args = [];
      args = args.concat(['add', '--dev'], allDependencies.devDependencies);
    } else {
      command = 'npm';
      args = args.concat(
        ['install', '--save', '--save-exact', '--loglevel', 'error'],
        allDependencies.dependencies
      );
      spawn(command, args, { stdio: 'inherit' });
      args = [];
      args = args.concat(
        ['install', '--dev', '--save-exact', '--loglevel', 'error'],
        allDependencies.devDependencies
      );
    }

    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('close', code => {
      if (code !== 0) {
        const err = new Error('install failed');
        err.command = `${command} ${args.join(' ')}`;
        reject(err);
        return;
      }
      resolve();
    });
  });

const run = async (root, botName, answer, useYarn) => {
  try {
    const allDependencies = {
      dependencies: ['babel-register', 'toolbot-core-experiment'],
      devDependencies: ['nodemon'],
    };
    print('Installing packages... This might take a couple of minutes.');
    print('');

    await install(useYarn, allDependencies);

    const indexFile = generateIndexFile(answer);
    fs.writeFileSync(path.join(root, 'index.js'), indexFile);

    if (answer.platform !== 'console') {
      const botJson = generateBotJson(answer.platform);
      fs.writeFileSync(
        path.join(root, 'bot.json'),
        JSON.stringify(botJson, null, 2)
      );
      print(
        `\n\nAlready creat ${bold(
          'bot.json'
        )} for you, please make sure you have edited it before run the bot.\n\n`
      );
    }
  } catch (reason) {
    print('');
    print('Aborting installation.');
    if (reason.command) {
      error(`  ${reason.command} has failed.`);
    } else {
      error('Unexpected error. Please report it as a bug:');
      print(reason);
    }
    print('');

    const knownGeneratedFiles = [
      'package.json',
      'npm-debug.log',
      'yarn-error.log',
      'yarn-debug.log',
      'node_modules',
    ];
    const currentFiles = fs.readdirSync(path.join(root));
    currentFiles.forEach(file => {
      knownGeneratedFiles.forEach(fileToMatch => {
        if (
          (fileToMatch.match(/.log/g) && file.indexOf(fileToMatch) === 0) ||
          file === fileToMatch
        ) {
          print(`Deleting generated file... ${file}`);
          fs.removeSync(path.join(root, file));
        }
      });
    });
    const remainingFiles = fs.readdirSync(path.join(root));
    if (!remainingFiles.length) {
      print(`Deleting ${botName} / from ${path.resolve(root, '..')}`);
      process.chdir(path.resolve(root, '..'));
      fs.removeSync(path.join(root));
    }
    print('Done.');
    return process.exit(1);
  }
};

const createBot = async answer => {
  const { name, platform } = answer;
  const root = path.resolve(name);
  const botName = path.basename(root);

  if (!checkBotName(botName)) {
    return process.exit(1);
  }
  fs.ensureDirSync(name);
  if (!isSafeToCreateProjectIn(root, name)) {
    return process.exit(1);
  }

  print(`Creating a new ${platform} bot in ${root}.`);
  print('');

  const packageJson = {
    name: botName,
    version: '0.1.0',
    private: true,
    scripts: {
      dev: 'nodemon index.js',
      start: 'node index.js',
    },
  };
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify(packageJson, null, 2)
  );

  process.chdir(root);

  const useYarn = shouldUseYarn();
  await run(root, botName, answer, useYarn);
};

export default (async function init() {
  try {
    const answer = await inquirer.prompt(questions);

    const { name } = answer;

    if (typeof name === 'undefined' || name === '') {
      print('');
      error('Please specify the project name');
      print('For example:');
      print("  ? What's your project name? my-bot");
      print('');
      print("Run 'tce --help' to see all options.");
      return process.exit(1);
    }

    await createBot(answer);
  } catch (err) {
    error('init error with');
    if (err.response) {
      error(`status: ${err.response.status}`);
    } else {
      error(`message: ${err.message}`);
    }
    return process.exit(1);
  }
});