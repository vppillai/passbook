"""
Email templates for various notification types.
"""

def get_invitation_email_template(invitation_url: str, family_name: str, inviter_name: str) -> tuple[str, str]:
    """
    Get invitation email template.

    Returns:
        Tuple of (subject, html_body)
    """
    subject = f"You've been invited to join {family_name} on Passbook"

    html_body = f"""
    <html>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #007AFF;">You've been invited!</h2>
            <p>Hello,</p>
            <p><strong>{inviter_name}</strong> has invited you to join the <strong>{family_name}</strong> family account on Passbook.</p>
            <p>Passbook is a family allowance management system that helps parents teach children financial responsibility.</p>
            <div style="text-align: center; margin: 30px 0;">
                <a href="{invitation_url}"
                   style="background-color: #007AFF; color: white; padding: 12px 24px;
                          text-decoration: none; border-radius: 8px; display: inline-block;">
                    Accept Invitation
                </a>
            </div>
            <p>This invitation will expire in 7 days.</p>
            <p>If you didn't expect this invitation, you can safely ignore this email.</p>
            <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
            <p style="font-size: 12px; color: #999;">
                If the button doesn't work, copy and paste this link into your browser:<br>
                {invitation_url}
            </p>
        </div>
    </body>
    </html>
    """

    text_body = f"""
    You've been invited!

    {inviter_name} has invited you to join the {family_name} family account on Passbook.

    Accept your invitation by visiting:
    {invitation_url}

    This invitation will expire in 7 days.

    If you didn't expect this invitation, you can safely ignore this email.
    """

    return subject, html_body, text_body


def get_password_reset_email_template(reset_url: str) -> tuple[str, str, str]:
    """
    Get password reset email template.

    Returns:
        Tuple of (subject, html_body, text_body)
    """
    subject = "Reset your Passbook password"

    html_body = f"""
    <html>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #007AFF;">Password Reset Request</h2>
            <p>Hello,</p>
            <p>You requested to reset your password for your Passbook account.</p>
            <div style="text-align: center; margin: 30px 0;">
                <a href="{reset_url}"
                   style="background-color: #007AFF; color: white; padding: 12px 24px;
                          text-decoration: none; border-radius: 8px; display: inline-block;">
                    Reset Password
                </a>
            </div>
            <p>This link will expire in 1 hour.</p>
            <p>If you didn't request this password reset, you can safely ignore this email.</p>
            <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
            <p style="font-size: 12px; color: #999;">
                If the button doesn't work, copy and paste this link into your browser:<br>
                {reset_url}
            </p>
        </div>
    </body>
    </html>
    """

    text_body = f"""
    Password Reset Request

    You requested to reset your password for your Passbook account.

    Reset your password by visiting:
    {reset_url}

    This link will expire in 1 hour.

    If you didn't request this password reset, you can safely ignore this email.
    """

    return subject, html_body, text_body
