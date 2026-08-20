import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MessagesService } from './messages.service';
import { SendMessageDto } from './dto/send-message.dto';

@Controller('chats')
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @UseGuards(JwtAuthGuard)
  @Post('messages')
  send(@Req() req: any, @Body() dto: SendMessageDto) {
    return this.messagesService.sendMessage(req.user.userId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':chatId/messages')
  history(
    @Req() req: any,
    @Param('chatId') chatId: string,
    @Query('limit') limit?: string,
  ) {
    return this.messagesService.getHistory(
      chatId,
      req.user.userId,
      limit ? parseInt(limit, 10) : 50,
    );
  }
}
