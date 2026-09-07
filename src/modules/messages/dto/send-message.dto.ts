import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class AttachmentDto {
  @IsUUID()
  mediaId!: string;

  // Populated server-side from MediaService's verified URL — never trust a
  // client-supplied value here, so it isn't required (or validated) on input.
  @IsOptional()
  @IsUrl()
  url?: string;

  @IsIn(['image', 'file', 'gif', 'video'])
  type!: string;

  @IsOptional()
  @IsString()
  fileName?: string;

  @IsOptional()
  @IsInt()
  sizeBytes?: number;

  @IsOptional()
  placeholder?: string;
}

export class SendMessageDto {
  @IsUUID()
  chatId!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  content?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AttachmentDto)
  attachments?: AttachmentDto[];
}
