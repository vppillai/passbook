## Features and workflow

This is a we based application that parents can use to provide allowances to children and track usage. The child can then login to their account and enter categorized expenses into the passbook . The available balance is clearly shown on login. This is a tool to manage allowances as well as teach kids financial discipline.

An account manager parent creates a family account and can then add other members into it. Other members could be another parent or kids. The other parent also gets account manager rights and becomes account manager.

Account manager including additional parent logins should be based on verified email addresses. When the account manager creates an account, they should get an email based activation before they can proceed with account setup. When a parent is invited into the account by the account manager they should get an email invitation. They then click on it to activate and setup their account to join the family account. Account manager sets up a user name and password for their account . The username should be unique within the family account but need not be universally unique. The parents should be able to edit the username and password of the kids account.

An email verification based password reset flow should be implemented for parent accounts as it is done with all standard web based applications. If a password is reset,

Parents adds funds. A funding period can be set for the child to easily see how long there is until additional funds will be added and also an indication of how frequently re-funding happens.  Refunding does not happen automatically. Additional funds can be added any time ad-hoc. The parents/managers gets a daily reminder when the funds have gone below 1.

The default currency is $. It is cad, but we use the $ symbol to display brevity. But the manager must be able to select the currency when  they create the account and also change it from a settings screen. The timezone of operation should also be selected based on the system from which the account is being created, but should be changeable later from the settings screen.

Expense addition should capture amount, description and category. Categories should include but not limited to snacks, food, games, sports, school, crafts, toys etc.

account manager and patrents should be able to add an expense item into any child account

Parents and children should be able to see analytics of expenses. for specific child accounts analytics shows what category the money was spent in, using a pie chart. The default period is the current accounting period, but a period should be selectable to see the analytics for the whole period. following the pie chart, a table should show actual amounts in the categories.

When the child adds an expense, they should be able to select

## General

Use gh tool to talk to github

Use GitHub project vppillai/passbook

Ensure secrets are not leaking but this should not come at the expense of too many manual steps involved in deployment. Use local .env files, aws acreets , GitHub secrets and protected variables etc.

Use jwt and other modern web technologies when applicable to ensure security

Create a comprehensive documentation of architecture, frontend, backend and deployment steps.

Ensure someone cloning our repo gas clean and concise documentation to deploy something themselves if they don't want to use our deployment. We want to make this an open-source tool that anyone can clone, and easily deploy in their AWS and GitHub.

## Backend

Backend uses AWS , but make sure you use only pay as you use services so that we included cost only for resources we use.

Use us-west-2 region as the default. But keep it configurable via the project configuration file.

The backend should be entirely using cloudformation based infrastructure as code. Apply infrastructure as code best practices .The backend should be deployed using AWS cloud formation so that there is a single place to deploy and teardown resources for the project . This includes lambda functions , API gateways, dynamo tables, secrets etc. when creating resources also ensure they have a passbook tag applied to identify them when from AWS console and tools.

When backend infra code changes, it should deploy Backend update with GitHub workflow and actions. Implement scripts that action can then use for the deployment. This way, we can also use thos scripts locally to test.

Comprehensive backend tests should be implemented to ensure quality.

Use Zoho email smtp in the backend when required with the following settings . In another developer wants to deploy this in their system they should  provide a different email address, password and server configuration . It should be easy for them to update this in a unified project level configuration file.

When backend stack changes it could result in url and some other paramter changes. There should be a good configuration file like mechanism that the frontend can consu,e during deployment.  front-end

## Frontend

When backend stack changes it could result in url and some other paramter changes. The front-end should be built in a configurable and parametrized manner to absorb these changes seamlessly during deployment. This will also make it easy for others to consume this open source project and deploy it in their own system.

Hosting is to be done with GitHub pages

The Web app must be responsive and work on mobile and desktop.

The look and feel of the application should be modern, minimalistic and sleek. Do not use emojis for icons. Instead use standardised SVG icons available for free. The layout should not look cluttered . Additional information can be structured into menus that can be launched from the primary view or tiles. When using animations, do not be overly flashy. Use subtle ones.

The frontend should be built to be child friendly since the child account users will be pre-teens or teens . But dont make it look childish. This is a tool to teach kids financial discipline and also to set them up for future banking applications. At the same time, it should not be too complex to drive them away.
